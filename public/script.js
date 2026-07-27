const socket = io();

let currentUser = null;
let cadetsData = [];
let usersData = [];
let logsData = [];
let availableWings = [];

let lastActivity = Date.now();
let userStatus = 'active';

document.addEventListener('mousemove', resetInactivity);
document.addEventListener('keypress', resetInactivity);

function resetInactivity() {
    lastActivity = Date.now();
    if (userStatus === 'sleep') {
        userStatus = 'active';
        sendStatusUpdate();
    }
}

setInterval(() => {
    if (currentUser && currentUser.approved) {
        if (Date.now() - lastActivity > 60000 && userStatus !== 'sleep') {
            userStatus = 'sleep';
            sendStatusUpdate();
        } else {
            sendStatusUpdate();
        }
    }
}, 10000);

function sendStatusUpdate() {
    if (!currentUser) return;
    fetch('/api/user-heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copyId: currentUser.copyId, status: userStatus })
    });
}

socket.on('cadetsUpdate', (data) => {
    cadetsData = data;
    renderCadets();
    updateStats();
});

socket.on('usersUpdate', (data) => {
    usersData = data;
    renderUsers();
    renderApproval();

    if (currentUser) {
        const updated = usersData.find(u => u.copyId === currentUser.copyId);
        if (updated) {
            currentUser = updated;
            if (currentUser.approved) {
                document.getElementById('loginModal').style.display = 'none';
            } else {
                document.getElementById('loginModal').style.display = 'flex';
                document.getElementById('loginStatus').innerHTML = `<span style="color:var(--accent-amber)">حسابك بانتظار موافقة المسؤول...</span>`;
            }
        }
    }
});

socket.on('logsUpdate', (data) => {
    logsData = data;
    renderLogs();
});

async function init() {
    try {
        const resWings = await fetch('/api/wings-list');
        availableWings = await resWings.json();

        const resCadets = await fetch('/api/cadets');
        cadetsData = await resCadets.json();

        const resUsers = await fetch('/api/users');
        usersData = await resUsers.json();

        const resLogs = await fetch('/api/logs');
        logsData = await resLogs.json();

        renderCadets();
        renderUsers();
        renderApproval();
        renderLogs();
        updateStats();

        const savedUser = localStorage.getItem('academy_user');
        if (savedUser) {
            currentUser = JSON.parse(savedUser);
            document.getElementById('loginUsername').value = currentUser.username;
            document.getElementById('loginCopyId').value = currentUser.copyId;
            checkLogin(currentUser.username, currentUser.copyId);
        }
    } catch (e) {
        console.error("Initialization error:", e);
    }
}

document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const copyId = document.getElementById('loginCopyId').value;
    checkLogin(username, copyId);
});

async function checkLogin(username, copyId) {
    const res = await fetch('/api/login-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, copyId })
    });
    const data = await res.json();

    currentUser = { username, copyId, approved: data.approved };
    localStorage.setItem('academy_user', JSON.stringify(currentUser));

    document.getElementById('displayLoggedUser').innerText = username;
    document.getElementById('displayLoggedStatus').innerText = `ID: ${copyId}`;

    if (data.approved) {
        document.getElementById('loginModal').style.display = 'none';
        sendStatusUpdate();
    } else {
        document.getElementById('loginModal').style.display = 'flex';
        document.getElementById('loginStatus').innerHTML = `<span style="color:var(--accent-amber)">تم إرسال الطلب، بانتظار موافقة المسؤول...</span>`;
    }
}

function updateStats() {
    document.getElementById('statTotal').innerText = cadetsData.length;
    const hours = cadetsData.reduce((acc, c) => acc + (c.hours || 0), 0);
    document.getElementById('statHours').innerText = hours.toFixed(1);
    const points = cadetsData.reduce((acc, c) => acc + (c.points || 0), 0);
    document.getElementById('statPoints').innerText = points;
}

function renderCadets() {
    const tbody = document.getElementById('cadetsTableBody');
    tbody.innerHTML = '';

    cadetsData.forEach(c => {
        const wingCount = c.wings ? c.wings.length : 0;
        tbody.innerHTML += `
            <tr>
                <td><b>${c.name}</b></td>
                <td><span style="color:var(--accent-blue);">${c.rank}</span></td>
                <td><span style="color:var(--accent-green); font-weight:bold;">${c.hours || 0} س</span></td>
                <td><span style="color:var(--accent-amber); font-weight:bold;">${c.points || 0} ن</span></td>
                <td>
                    <button class="badge-wings" onclick="openWingsDetails('${c.discordId}')">
                        <i class="fa-solid fa-award"></i> ${wingCount} وينق
                    </button>
                </td>
                <td>
                    <button class="btn" style="background:rgba(255,255,255,0.1); color:#fff;" onclick="openReportsDetails('${c.discordId}')">
                        <i class="fa-solid fa-file-lines"></i> ${c.reports ? c.reports.length : 0}
                    </button>
                </td>
                <td style="text-align:center;">
                    <button class="btn btn-primary" onclick="openEditModal('${c.discordId}')">
                        <i class="fa-solid fa-pen"></i> تعديل
                    </button>
                </td>
            </tr>
        `;
    });
}

function renderUsers() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    usersData.forEach(u => {
        let badge = '';
        if (u.status === 'active') {
            badge = `<span class="badge-status" style="background:rgba(16,185,129,0.2); color:var(--accent-green);"><span class="status-dot status-active"></span> Active</span>`;
        } else if (u.status === 'sleep') {
            badge = `<span class="badge-status" style="background:rgba(245,158,11,0.2); color:var(--accent-amber);"><span class="status-dot status-sleep"></span> Sleep</span>`;
        } else {
            badge = `<span class="badge-status" style="background:rgba(239,68,68,0.2); color:var(--accent-red);"><span class="status-dot status-no-active"></span> No Active</span>`;
        }

        tbody.innerHTML += `
            <tr>
                <td><b>${u.username}</b></td>
                <td>${u.copyId}</td>
                <td>${badge}</td>
                <td>${u.approved ? '<span style="color:var(--accent-green)">مقبول</span>' : '<span style="color:var(--accent-red)">معلق</span>'}</td>
            </tr>
        `;
    });
}

function renderApproval() {
    const tbody = document.getElementById('approvalTableBody');
    tbody.innerHTML = '';

    const pending = usersData.filter(u => !u.approved);
    if (pending.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-secondary);">لا توجد طلبات معلقة حالياً</td></tr>`;
        return;
    }

    pending.forEach(u => {
        tbody.innerHTML += `
            <tr>
                <td><b>${u.username}</b></td>
                <td>${u.copyId}</td>
                <td style="text-align:center;">
                    <button class="btn btn-success" onclick="approveUser('${u.copyId}', true)">قبول</button>
                    <button class="btn btn-danger" onclick="approveUser('${u.copyId}', false)">رفض</button>
                </td>
            </tr>
        `;
    });
}

async function approveUser(copyId, approve) {
    await fetch('/api/approve-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copyId, approve, adminName: currentUser ? currentUser.username : 'Admin' })
    });
}

function renderLogs() {
    const tbody = document.getElementById('logsTableBody');
    tbody.innerHTML = '';

    logsData.forEach(l => {
        tbody.innerHTML += `
            <tr>
                <td><b style="color:var(--accent-blue);">${l.by}</b></td>
                <td>${l.action}</td>
                <td><b>${l.target}</b></td>
                <td style="color:var(--text-secondary); font-size:12px;">${l.time}</td>
            </tr>
        `;
    });
}

function openWingsDetails(discordId) {
    const cadet = cadetsData.find(c => c.discordId === discordId);
    if (!cadet) return;

    document.getElementById('wingsModalTitle').innerText = `وينقات العسكري: ${cadet.name}`;
    const container = document.getElementById('wingsListDetails');
    container.innerHTML = '';

    if (!cadet.wings || cadet.wings.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">لا يملك أي وينقات حالياً</p>';
    } else {
        cadet.wings.forEach(wId => {
            const wInfo = availableWings.find(w => w.id === wId) || { name: wId, icon: 'fa-shield' };
            container.innerHTML += `
                <div style="background:rgba(255,255,255,0.05); padding:10px 15px; border-radius:8px; display:flex; align-items:center; gap:10px;">
                    <i class="fa-solid ${wInfo.icon}" style="color:var(--accent-indigo); font-size:18px;"></i>
                    <span style="font-weight:bold;">${wInfo.name}</span>
                </div>
            `;
        });
    }

    document.getElementById('wingsModal').style.display = 'flex';
}

function openReportsDetails(discordId) {
    const cadet = cadetsData.find(c => c.discordId === discordId);
    if (!cadet) return;

    document.getElementById('reportsModalTitle').innerText = `تقارير العسكري: ${cadet.name}`;
    const container = document.getElementById('reportsListDetails');
    container.innerHTML = '';

    if (!cadet.reports || cadet.reports.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">لا توجد تقارير مسجلة</p>';
    } else {
        cadet.reports.forEach(r => {
            container.innerHTML += `
                <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:8px; border-right:3px solid var(--accent-blue);">
                    <div style="font-size:11px; color:var(--text-secondary);">${r.date}</div>
                    <div style="font-weight:bold; font-size:13px;">${r.title}</div>
                    <div style="font-size:12px; color:var(--text-secondary);">${r.content}</div>
                </div>
            `;
        });
    }

    document.getElementById('reportsModal').style.display = 'flex';
}

function openEditModal(discordId) {
    const cadet = cadetsData.find(c => c.discordId === discordId);
    if (!cadet) return;

    document.getElementById('editDiscordId').value = cadet.discordId;
    document.getElementById('editModalTitle').innerText = `تعديل: ${cadet.name}`;
    document.getElementById('editHours').value = cadet.hours || 0;
    document.getElementById('editPoints').value = cadet.points || 0;
    document.getElementById('editReportTitle').value = '';
    document.getElementById('editReportContent').value = '';

    const wingsContainer = document.getElementById('wingsContainer');
    wingsContainer.innerHTML = '';

    availableWings.forEach(w => {
        const isChecked = cadet.wings && cadet.wings.includes(w.id) ? 'checked' : '';
        wingsContainer.innerHTML += `
            <label>
                <input type="checkbox" name="wings" value="${w.id}" ${isChecked}>
                <i class="fa-solid ${w.icon}"></i> ${w.name}
            </label>
        `;
    });

    document.getElementById('editModal').style.display = 'flex';
}

document.getElementById('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const discordId = document.getElementById('editDiscordId').value;
    const hours = document.getElementById('editHours').value;
    const points = document.getElementById('editPoints').value;
    const reportTitle = document.getElementById('editReportTitle').value;
    const reportContent = document.getElementById('editReportContent').value;

    const selectedWings = Array.from(document.querySelectorAll('input[name="wings"]:checked')).map(cb => cb.value);

    await fetch('/api/update-cadet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            discordId,
            hours,
            points,
            wings: selectedWings,
            reportTitle,
            reportContent,
            editedBy: currentUser ? currentUser.username : 'Admin'
        })
    });

    closeModal('editModal');
});

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function switchView(viewName, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.getElementById('viewCadets').style.display = viewName === 'cadets' ? 'block' : 'none';
    document.getElementById('viewUsers').style.display = viewName === 'users' ? 'block' : 'none';
    document.getElementById('viewApproval').style.display = viewName === 'approval' ? 'block' : 'none';
    document.getElementById('viewLogs').style.display = viewName === 'logs' ? 'block' : 'none';
}

init();
