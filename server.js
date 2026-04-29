const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const pool = mysql.createPool({
    host: process.env.SQL_HOST || '192.168.10.2',
    port: Number(process.env.SQL_PORT || 3306),
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DATABASE || 'servicelog',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

app.use(express.json());
app.use(express.static(__dirname));

function groupServiceRows(rows) {
    const logsByComposite = new Map();

    rows.forEach((row) => {
        const dateOnly = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10);
        const compositeKey = `${row.vin}|${dateOnly}|${row.odometer}`;

        if (!logsByComposite.has(compositeKey)) {
            logsByComposite.set(compositeKey, {
                // Representative id for edit/delete actions in the UI.
                id: row.id,
                vin: row.vin,
                date: dateOnly,
                odometer: row.odometer,
                parts: []
            });
        } else if (row.id < logsByComposite.get(compositeKey).id) {
            logsByComposite.get(compositeKey).id = row.id;
        }

        logsByComposite.get(compositeKey).parts.push({
            id: row.id,
            name: row.part,
            number: row.partnr
        });
    });

    const logs = Array.from(logsByComposite.values());

    // Group by odometer for UI rendering and keep descending mileage order.
    const grouped = {};
    logs.forEach((log) => {
        const key = String(log.odometer);
        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(log);
    });

    return {
        logs,
        groups: Object.keys(grouped)
            .sort((a, b) => Number(b) - Number(a))
            .map((odometerKey) => ({
                odometer: Number(odometerKey),
                logs: grouped[odometerKey].sort((a, b) => new Date(b.date) - new Date(a.date))
            }))
    };
}

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Database connection failed.' });
    }
});

app.get('/api/cars', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `
            SELECT c.make, c.model, c.year, c.odometer, c.plate, c.vin,
                   COALESCE(
                       (
                           SELECT s2.odometer
                           FROM service s2
                           WHERE s2.vin = c.vin
                           ORDER BY s2.date DESC, s2.odometer DESC, s2.id DESC
                           LIMIT 1
                       ),
                       c.odometer
                   ) AS currentMileage,
                   COUNT(DISTINCT CONCAT(s.vin, '|', DATE(s.date), '|', s.odometer)) AS serviceCount
            FROM cars c
            LEFT JOIN service s ON s.vin = c.vin
            GROUP BY c.vin, c.make, c.model, c.year, c.odometer, c.plate
            ORDER BY c.year DESC, c.make ASC, c.model ASC
            `
        );

        const cars = rows.map((row) => ({
            make: row.make,
            model: row.model,
            year: row.year,
            odometer: row.odometer,
            currentMileage: row.currentMileage,
            plate: row.plate,
            vin: row.vin,
            serviceCount: Number(row.serviceCount || 0)
        }));

        res.json(cars);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch cars.' });
    }
});

app.post('/api/cars', async (req, res) => {
    const { make, model, year, odometer, plate, vin } = req.body;

    if (!make || !model || !year || !vin || odometer === undefined || odometer === null || odometer === '') {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    try {
        await pool.query(
            'INSERT INTO cars (make, model, `year`, odometer, plate, vin) VALUES (?, ?, ?, ?, ?, ?)',
            [make, model, year, Number(odometer), plate || '', vin]
        );

        res.status(201).json({ message: 'Car created.' });
    } catch (error) {
        console.error(error);
        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'A car with this VIN already exists.' });
        }
        res.status(500).json({ message: 'Failed to create car.' });
    }
});

app.delete('/api/cars/:vin', async (req, res) => {
    const { vin } = req.params;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();
        await connection.query('DELETE FROM service WHERE vin = ?', [vin]);
        await connection.query('DELETE FROM cars WHERE vin = ?', [vin]);
        await connection.commit();
        res.json({ message: 'Car deleted.' });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ message: 'Failed to delete car.' });
    } finally {
        connection.release();
    }
});

app.get('/api/cars/:vin/services', async (req, res) => {
    const { vin } = req.params;

    try {
        const [rows] = await pool.query(
            `
            SELECT id, vin, date, odometer, part, partnr
            FROM service
            WHERE vin = ?
            ORDER BY odometer DESC, date DESC, id DESC
            `,
            [vin]
        );

        res.json(groupServiceRows(rows));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch services.' });
    }
});

app.post('/api/cars/:vin/services', async (req, res) => {
    const { vin } = req.params;
    const { date, odometer, parts } = req.body;

    if (!date || odometer === undefined || odometer === null || odometer === '') {
        return res.status(400).json({ message: 'Missing required service fields.' });
    }

    if (!Array.isArray(parts) || parts.length === 0) {
        return res.status(400).json({ message: 'At least one part is required.' });
    }

    const normalizedParts = parts
        .map((part) => ({
            name: String(part.name || '').trim(),
            number: String(part.number || '').trim() || 'N/A'
        }))
        .filter((part) => part.name);

    if (normalizedParts.length === 0) {
        return res.status(400).json({ message: 'At least one valid part is required.' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [idRows] = await connection.query('SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM service');
        const nextId = Number(idRows[0].nextId);

        const values = normalizedParts.map((part, index) => [
            nextId + index,
            vin,
            date,
            Number(odometer),
            part.name,
            part.number
        ]);

        await connection.query(
            'INSERT INTO service (id, vin, date, odometer, part, partnr) VALUES ?',
            [values]
        );

        await connection.commit();
        res.status(201).json({ message: 'Service created.', ids: values.map((entry) => entry[0]) });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ message: 'Failed to create service.' });
    } finally {
        connection.release();
    }
});

app.put('/api/cars/:vin/services/:id', async (req, res) => {
    const { vin, id } = req.params;
    const { date, odometer, parts } = req.body;

    if (!date || odometer === undefined || odometer === null || odometer === '') {
        return res.status(400).json({ message: 'Missing required service fields.' });
    }

    if (!Array.isArray(parts) || parts.length === 0) {
        return res.status(400).json({ message: 'At least one part is required.' });
    }

    const normalizedParts = parts
        .map((part) => ({
            name: String(part.name || '').trim(),
            number: String(part.number || '').trim() || 'N/A'
        }))
        .filter((part) => part.name);

    if (normalizedParts.length === 0) {
        return res.status(400).json({ message: 'At least one valid part is required.' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [existingRows] = await connection.query(
            'SELECT vin, date, odometer FROM service WHERE vin = ? AND id = ? LIMIT 1',
            [vin, Number(id)]
        );

        if (existingRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Service entry not found.' });
        }

        const existing = existingRows[0];

        await connection.query('DELETE FROM service WHERE vin = ? AND date = ? AND odometer = ?', [
            existing.vin,
            existing.date,
            existing.odometer
        ]);

        const [idRows] = await connection.query('SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM service');
        const nextId = Number(idRows[0].nextId);

        const values = normalizedParts.map((part, index) => [
            nextId + index,
            vin,
            date,
            Number(odometer),
            part.name,
            part.number
        ]);

        await connection.query(
            'INSERT INTO service (id, vin, date, odometer, part, partnr) VALUES ?',
            [values]
        );

        await connection.commit();
        res.json({ message: 'Service updated.' });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ message: 'Failed to update service.' });
    } finally {
        connection.release();
    }
});

app.delete('/api/cars/:vin/services/:id', async (req, res) => {
    const { vin, id } = req.params;

    try {
        const [existingRows] = await pool.query(
            'SELECT vin, date, odometer FROM service WHERE vin = ? AND id = ? LIMIT 1',
            [vin, Number(id)]
        );

        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'Service entry not found.' });
        }

        const existing = existingRows[0];
        await pool.query('DELETE FROM service WHERE vin = ? AND date = ? AND odometer = ?', [
            existing.vin,
            existing.date,
            existing.odometer
        ]);
        res.json({ message: 'Service deleted.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to delete service.' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`GarageLog server listening on port ${port}`);
});
