let cars = [];
let activeCarVin = null;
let editingLogId = null;
let groupedServices = [];

const dashboardView = document.getElementById('dashboard-view');
const carDetailsView = document.getElementById('car-details-view');
const carsListEl = document.getElementById('cars-list');
const logsListEl = document.getElementById('logs-list');
const partsContainer = document.getElementById('parts-container');
const activeCarHeader = document.getElementById('active-car-header');

const addCarForm = document.getElementById('add-car-form');
const addLogForm = document.getElementById('add-log-form');

initialize();

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function normalizeDateInput(value) {
    if (!value) {
        return '';
    }

    if (typeof value === 'string' && value.includes('T')) {
        return value.split('T')[0];
    }

    return String(value).slice(0, 10);
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json'
        },
        ...options
    });

    if (!response.ok) {
        let message = 'Request failed.';
        try {
            const data = await response.json();
            message = data.message || message;
        } catch (error) {
            // Keep default message when no JSON body exists.
        }
        throw new Error(message);
    }

    if (response.status === 204) {
        return null;
    }

    return response.json();
}

async function initialize() {
    addCarForm.addEventListener('submit', handleAddCar);
    addLogForm.addEventListener('submit', handleAddLog);

    document.getElementById('log-date').valueAsDate = new Date();

    await fetchCars();
}

async function fetchCars() {
    try {
        cars = await apiRequest('/api/cars');
        renderCars();
    } catch (error) {
        carsListEl.innerHTML = `<p class="text-red-500 text-center py-6 bg-white rounded-xl shadow-sm">${escapeHtml(error.message)}</p>`;
    }
}

async function handleAddCar(event) {
    event.preventDefault();

    const payload = {
        make: document.getElementById('car-make').value.trim(),
        model: document.getElementById('car-model').value.trim(),
        year: document.getElementById('car-year').value.trim(),
        odometer: document.getElementById('car-odometer').value.trim(),
        plate: document.getElementById('car-plate').value.trim().toUpperCase(),
        vin: document.getElementById('car-vin').value.trim().toUpperCase()
    };

    try {
        await apiRequest('/api/cars', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        addCarForm.reset();
        await fetchCars();
    } catch (error) {
        alert(error.message);
    }
}

function renderCars() {
    if (cars.length === 0) {
        carsListEl.innerHTML = '<p class="text-slate-500 text-center py-6 bg-white rounded-xl shadow-sm">No cars added yet. Add one above.</p>';
        return;
    }

    carsListEl.innerHTML = cars
        .map((car) => `
            <button type="button" class="w-full text-left bg-white p-5 rounded-xl shadow-sm border border-slate-200 cursor-pointer hover:shadow-md transition flex flex-col md:flex-row justify-between md:items-center gap-4 open-car-btn" data-vin="${escapeHtml(car.vin)}">
                <div>
                    <h3 class="text-xl font-bold text-slate-800">${escapeHtml(car.year)} ${escapeHtml(car.make)} ${escapeHtml(car.model)}</h3>
                    ${car.vin ? `<p class="text-xs text-slate-500 font-mono mt-1">VIN: ${escapeHtml(car.vin)}</p>` : ''}
                    <p class="text-sm text-slate-500 mt-1">Current mileage: ${Number(car.currentMileage ?? car.odometer).toLocaleString('nl-NL')} km</p>
                    <p class="text-sm text-slate-500 mt-1">${Number(car.serviceCount || 0)} service records</p>
                </div>
                ${car.plate ? `<div class="nl-plate text-lg">${escapeHtml(car.plate)}</div>` : ''}
            </button>
        `)
        .join('');

    document.querySelectorAll('.open-car-btn').forEach((btn) => {
        btn.addEventListener('click', () => openCarDetails(btn.dataset.vin));
    });
}

async function deleteCar(vin) {
    if (!confirm('Are you sure you want to delete this car and all its records?')) {
        return;
    }

    try {
        await apiRequest(`/api/cars/${encodeURIComponent(vin)}`, {
            method: 'DELETE'
        });
        activeCarVin = null;
        editingLogId = null;
        groupedServices = [];
        await fetchCars();
        showDashboard();
    } catch (error) {
        alert(error.message);
    }
}

async function openCarDetails(vin) {
    activeCarVin = vin;
    editingLogId = null;

    const car = cars.find((entry) => entry.vin === vin);
    if (!car) {
        return;
    }

    activeCarHeader.innerHTML = `
        <div>
            <h2 class="text-2xl font-bold">${escapeHtml(car.year)} ${escapeHtml(car.make)} ${escapeHtml(car.model)}</h2>
            ${car.vin ? `<p class="text-sm text-slate-400 font-mono mt-1">VIN: ${escapeHtml(car.vin)}</p>` : ''}
            <p class="text-sm text-slate-400 mt-1">Bought at ${Number(car.odometer).toLocaleString('nl-NL')} km</p>
        </div>
        <div class="flex flex-col items-end gap-2">
            ${car.plate ? `<div class="nl-plate text-sm">${escapeHtml(car.plate)}</div>` : ''}
            <button type="button" class="text-red-400 text-xs hover:text-red-300 delete-car-btn" data-vin="${escapeHtml(car.vin)}">Delete Car</button>
        </div>
    `;

    const deleteCarButton = activeCarHeader.querySelector('.delete-car-btn');
    if (deleteCarButton) {
        deleteCarButton.addEventListener('click', () => deleteCar(deleteCarButton.dataset.vin));
    }

    addLogForm.reset();
    document.getElementById('log-date').valueAsDate = new Date();
    partsContainer.innerHTML = initialPartRow();

    await fetchServices();

    dashboardView.classList.add('hidden');
    carDetailsView.classList.remove('hidden');
}

function showDashboard() {
    activeCarVin = null;
    editingLogId = null;
    groupedServices = [];
    dashboardView.classList.remove('hidden');
    carDetailsView.classList.add('hidden');
    renderCars();
}

function initialPartRow() {
    return `
        <div class="flex gap-2 part-entry">
            <input type="text" placeholder="Part Name (e.g. Oil Filter)" required class="w-1/2 border border-slate-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none part-name">
            <input type="text" placeholder="Part Nr (e.g. HU719/7X)" class="w-1/2 border border-slate-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none part-number">
        </div>
    `;
}

function addPartField() {
    const entry = document.createElement('div');
    entry.className = 'flex gap-2 part-entry mt-2';
    entry.innerHTML = `
        <input type="text" placeholder="Part Name" required class="w-1/2 border border-slate-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none part-name">
        <input type="text" placeholder="Part Nr" class="w-1/2 border border-slate-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none part-number">
        <button type="button" onclick="this.parentElement.remove()" class="text-red-500 p-2 rounded hover:bg-red-50 font-bold">&times;</button>
    `;
    partsContainer.appendChild(entry);
}

async function handleAddLog(event) {
    event.preventDefault();

    const parts = collectPartsFromContainer(partsContainer);

    if (parts.length === 0) {
        alert('Please add at least one part name.');
        return;
    }

    const payload = {
        date: document.getElementById('log-date').value,
        odometer: document.getElementById('log-odometer').value,
        parts
    };

    try {
        await apiRequest(`/api/cars/${encodeURIComponent(activeCarVin)}/services`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        document.getElementById('log-odometer').value = '';
        partsContainer.innerHTML = initialPartRow();

        await fetchCars();
        await fetchServices();
    } catch (error) {
        alert(error.message);
    }
}

function collectPartsFromContainer(container) {
    const parts = [];

    container.querySelectorAll('.part-entry').forEach((row) => {
        const name = row.querySelector('.part-name').value.trim();
        const number = row.querySelector('.part-number').value.trim();
        if (name) {
            parts.push({ name, number: number || 'N/A' });
        }
    });

    return parts;
}

async function fetchServices() {
    try {
        const data = await apiRequest(`/api/cars/${encodeURIComponent(activeCarVin)}/services`);
        groupedServices = data.groups || [];
        renderLogs();
    } catch (error) {
        logsListEl.innerHTML = `<p class="text-red-500 text-center py-6 bg-white rounded-xl shadow-sm">${escapeHtml(error.message)}</p>`;
    }
}

function findLogById(logId) {
    for (const group of groupedServices) {
        const found = group.logs.find((log) => Number(log.id) === Number(logId));
        if (found) {
            return found;
        }
    }
    return null;
}

function startEditLog(logId) {
    editingLogId = Number(logId);
    renderLogs();
}

function cancelEditLog() {
    editingLogId = null;
    renderLogs();
}

function addEditPartField(logId) {
    const container = document.getElementById(`edit-parts-${logId}`);
    if (!container) {
        return;
    }

    const entry = document.createElement('div');
    entry.className = 'flex gap-2 part-entry mt-2';
    entry.innerHTML = `
        <input type="text" placeholder="Part Name" required class="w-1/2 border border-slate-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none part-name">
        <input type="text" placeholder="Part Nr" class="w-1/2 border border-slate-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none part-number">
        <button type="button" onclick="this.parentElement.remove()" class="text-red-500 p-2 rounded hover:bg-red-50 font-bold">&times;</button>
    `;
    container.appendChild(entry);
}

async function saveEditedLog(logId, event) {
    event.preventDefault();

    const form = event.target;
    const partsContainerEdit = form.querySelector(`#edit-parts-${logId}`);
    const parts = collectPartsFromContainer(partsContainerEdit);

    if (parts.length === 0) {
        alert('Please keep at least one part.');
        return;
    }

    const payload = {
        date: form.querySelector('.edit-log-date').value,
        odometer: form.querySelector('.edit-log-odometer').value,
        parts
    };

    try {
        await apiRequest(`/api/cars/${encodeURIComponent(activeCarVin)}/services/${Number(logId)}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        editingLogId = null;
        await fetchCars();
        await fetchServices();
    } catch (error) {
        alert(error.message);
    }
}

function renderLogs() {
    if (groupedServices.length === 0) {
        logsListEl.innerHTML = '<p class="text-slate-500 text-center py-6 bg-white rounded-xl shadow-sm">No service records found for this car.</p>';
        return;
    }

    logsListEl.innerHTML = groupedServices
        .map((group) => {
            const logsHtml = group.logs
                .map((log) => {
                    const isEditing = Number(editingLogId) === Number(log.id);

                    if (isEditing) {
                        return `
                            <form class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-4" onsubmit="saveEditedLog('${Number(log.id)}', event)">
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 w-full border-b pb-3 mb-3">
                                    <div>
                                        <label class="block text-xs font-bold text-slate-400 uppercase mb-1">Date</label>
                                        <input type="date" value="${normalizeDateInput(log.date)}" class="edit-log-date w-full border border-slate-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required>
                                    </div>
                                    <div>
                                        <label class="block text-xs font-bold text-slate-400 uppercase mb-1">Odometer</label>
                                        <input type="number" value="${Number(log.odometer)}" class="edit-log-odometer w-full border border-slate-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required>
                                    </div>
                                </div>
                                <div>
                                    <h4 class="text-xs font-bold text-slate-400 uppercase mb-2">Parts Changed</h4>
                                    <div id="edit-parts-${Number(log.id)}" class="space-y-3">
                                        ${log.parts
                                            .map(
                                                (part) => `
                                                <div class="flex gap-2 part-entry">
                                                    <input type="text" value="${escapeHtml(part.name)}" required class="w-1/2 border border-slate-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none part-name">
                                                    <input type="text" value="${escapeHtml(part.number === 'N/A' ? '' : part.number)}" class="w-1/2 border border-slate-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none part-number">
                                                    <button type="button" onclick="this.parentElement.remove()" class="text-red-500 p-2 rounded hover:bg-red-50 font-bold">&times;</button>
                                                </div>
                                            `
                                            )
                                            .join('')}
                                    </div>
                                    <button type="button" onclick="addEditPartField('${Number(log.id)}')" class="text-sm font-semibold text-blue-600 mt-3 inline-block hover:underline">+ Add another part</button>
                                </div>
                                <div class="flex flex-wrap gap-3 pt-2">
                                    <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 transition">Save Changes</button>
                                    <button type="button" onclick="cancelEditLog()" class="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg font-bold hover:bg-slate-200 transition">Cancel</button>
                                </div>
                            </form>
                        `;
                    }

                    return `
                        <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                            <div class="flex justify-between items-center border-b pb-3 mb-3">
                                <div class="font-bold text-slate-800">${new Date(log.date).toLocaleDateString('en-GB', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric'
                                })}</div>
                                <div class="bg-slate-100 px-3 py-1 rounded-full text-sm font-mono text-slate-600">${Number(log.odometer).toLocaleString('nl-NL')} km</div>
                            </div>
                            <div>
                                <h4 class="text-xs font-bold text-slate-400 uppercase mb-2">Parts Changed</h4>
                                <ul class="space-y-1">
                                    ${log.parts
                                        .map(
                                            (part) => `
                                            <li class="flex justify-between text-sm">
                                                <span class="font-medium">${escapeHtml(part.name)}</span>
                                                <span class="text-slate-500 font-mono text-xs ml-4 border border-slate-200 rounded px-1">${escapeHtml(part.number)}</span>
                                            </li>
                                        `
                                        )
                                        .join('')}
                                </ul>
                            </div>
                            <div class="mt-4 flex gap-4">
                                <button type="button" onclick="startEditLog('${Number(log.id)}')" class="text-xs text-blue-600 hover:underline">Edit Entry</button>
                                <button type="button" onclick="deleteLog('${Number(log.id)}')" class="text-xs text-red-500 hover:underline">Delete Entry</button>
                            </div>
                        </div>
                    `;
                })
                .join('');

            return `
                <section class="space-y-4">
                    ${logsHtml}
                </section>
            `;
        })
        .join('');
}

async function deleteLog(logId) {
    if (!confirm('Delete this service record?')) {
        return;
    }

    try {
        await apiRequest(`/api/cars/${encodeURIComponent(activeCarVin)}/services/${Number(logId)}`, {
            method: 'DELETE'
        });

        editingLogId = null;
        await fetchCars();
        await fetchServices();
    } catch (error) {
        alert(error.message);
    }
}
