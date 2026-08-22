const socket = io();

let currentUser = null;
let availableWings = [];
let globalAllPolice = [];
let globalCadetsOnly = [];

fetch('/api/wings-list')
    .then(res => res.json())
    .then(data => { availableWings = data; });

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const copyId = document.getElementById('loginCopyId').value.trim();
    const statusDiv = document.getElementById('loginStatus');

    statusDiv.style.color = '#f59e0b';
    statusDiv.textContent = 'جاري التحقق من الطلب...';

    const res = await fetch('/api/login-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, copyId })
    });

    const data = await res.json();
    currentUser = { username, copyId, approved: data.approved };

    if (data.approved) {
        // إخفاء نافذة الدخول فوراً بدون انتظار
        document.getElementById('loginModal').style.display = 'none';
        document.getElementById('displayLoggedUser').textContent = username;
        document.getElementById('displayLoggedStatus').textContent = `معرّف: ${copyId}`;
        startHeartbeat();
    } else {
        statusDiv.style.color = '#ef4444';
        statusDiv.textContent = 'في انتظار موافقة المسؤول لتسجيل الدخول...';
    }
});

function startHeartbeat() {
    setInterval(() => {
        if (currentUser && currentUser.approved) {
            fetch('/api/user-heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ copyId: currentUser.copyId })
            });
        }
    }, 15000);
}

socket.on('policeDataUpdate', (data) => {
    globalAllPolice = data.allPolice;
    globalCadetsOnly = data.cadets;

    renderTableRows('allPoliceTableBody', globalAllPolice);
    renderTableRows('cadetsOnlyTableBody', globalCadetsOnly);
    updateStats(globalAllPolice);
});

socket.on('usersUpdate', (users) => {
    renderUsers(users);
    renderApprovals(users);

    if (currentUser) {
        const myRecord = users.find(u => u.copyId === currentUser.copyId);
        if (myRecord && myRecord.approved && document.getElementById('loginModal').style.display !== 'none') {
            currentUser.approved = true;
            document.getElementById('loginModal').style.display = 'none';
            document.getElementById('displayLoggedUser').textContent = currentUser.username;
            document.getElementById('displayLoggedStatus').textContent = `معرّف: ${currentUser.copyId}`;
            startHeartbeat();
        }
    }
});

socket.on('logsUpdate', (logs) => {
    renderLogs(logs);
});

function renderTableRows(tableBodyId, dataList) {
    const tbody = document.getElementById(tableBodyId);
    tbody.innerHTML = '';

    if (!dataList || dataList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-secondary);">لا يوجد أعضاء في هذه القائمة</td></tr>';
        return;
    }

    dataList.forEach(c => {
        const wingsCount = (c.wings || []).length;
        const reportsCount = (c.reports || []).length;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${c.name}</b></td>
            <td><span style="background: rgba(56, 189, 248, 0.1); color: var(--accent-blue); padding: 4px 8px; border-radius: 6px; font-weight: bold;">${c.rank}</span></td>
            <td>${c.hours} ساعة</td>
            <td>${c.points} نقطة</td>
            <td><button class="badge-wings" onclick="openWingsModal('${c.discordId}')">${wingsCount} وينق/ات</button></td>
            <td><button class="badge-wings" style="background: rgba(245, 158, 11, 0.2); color: #fde68a;" onclick="openReportsModal('${c.discordId}')">${reportsCount} تقارير</button></td>
            <td style="text-align: center;">
                <button class="btn btn-primary" style="padding: 5px 10px; font-size: 12px;" onclick="openEditModal('${c.discordId}')"><i class="fa-solid fa-pen"></i> تعديل</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateStats(allPolice) {
    document.getElementById('statTotal').textContent = allPolice.length;
    const totalHours = allPolice.reduce((acc, c) => acc + (parseFloat(c.hours) || 0), 0);
    const totalPoints = allPolice.reduce((acc, c) => acc + (parseInt(c.points) || 0), 0);
    document.getElementById('statHours').textContent = totalHours.toFixed(1);
    document.getElementById('statPoints').textContent = totalPoints;
}

function renderUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    users.forEach(u => {
        let statusBadge = '<span class="badge-status" style="background: rgba(16, 185, 129, 0.2); color: var(--accent-green);"><span class="status-dot status-active"></span>متواجد</span>';
        if (u.status === 'no-active') {
            statusBadge = '<span class="badge-status" style="background: rgba(239, 68, 68, 0.2); color: var(--accent-red);"><span class="status-dot status-no-active"></span>غير نشط</span>';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${u.username}</td>
            <td><code>${u.copyId}</code></td>
            <td>${statusBadge}</td>
            <td>${u.approved ? '<span style="color: var(--accent-green);">مقبول</span>' : '<span style="color: var(--accent-amber);">بانتظار الموافقة</span>'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderApprovals(users) {
    const tbody = document.getElementById('approvalTableBody');
    tbody.innerHTML = '';

    const pending = users.filter(u => !u.approved);
    pending.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${u.username}</td>
            <td><code>${u.copyId}</code></td>
            <td style="text-align: center; display: flex; gap: 8px; justify-content: center;">
                <button class="btn btn-success" style="padding: 5px 12px; font-size: 12px;" onclick="approveUser('${u.copyId}', true)">قبول</button>
                <button class="btn btn-danger" style="padding: 5px 12px; font-size: 12px;" onclick="approveUser('${u.copyId}', false)">رفض</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderLogs(logs) {
    const tbody = document.getElementById('logsTableBody');
    tbody.innerHTML = '';

    logs.forEach(l => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${l.by}</b></td>
            <td>${l.action}</td>
            <td>${l.target}</td>
            <td style="color: var(--text-secondary); font-size: 12px;">${l.time}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function approveUser(copyId, approve) {
    await fetch('/api/approve-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copyId, approve, adminName: currentUser ? currentUser.username : 'Admin' })
    });
}

function openEditModal(discordId) {
    const cadet = globalAllPolice.find(c => c.discordId === discordId);
    if (!cadet) return;

    document.getElementById('editDiscordId').value = cadet.discordId;
    document.getElementById('editHours').value = cadet.hours;
    document.getElementById('editPoints').value = cadet.points;

    const wingsContainer = document.getElementById('wingsContainer');
    wingsContainer.innerHTML = '';

    availableWings.forEach(w => {
        const isChecked = (cadet.wings || []).includes(w.id) ? 'checked' : '';
        wingsContainer.innerHTML += `
            <label>
                <input type="checkbox" value="${w.id}" ${isChecked}>
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

    const checkedWings = Array.from(document.querySelectorAll('#wingsContainer input:checked')).map(cb => cb.value);

    await fetch('/api/update-cadet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            discordId,
            hours,
            points,
            wings: checkedWings,
            reportTitle,
            reportContent,
            editedBy: currentUser ? currentUser.username : 'Admin'
        })
    });

    closeModal('editModal');
});

function openWingsModal(discordId) {
    const cadet = globalAllPolice.find(c => c.discordId === discordId);
    if (!cadet) return;

    const details = document.getElementById('wingsListDetails');
    details.innerHTML = '';

    if (!cadet.wings || cadet.wings.length === 0) {
        details.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">لا توجد وينقات مكتسبة.</p>';
    } else {
        cadet.wings.forEach(wId => {
            const w = availableWings.find(item => item.id === wId) || { name: wId, icon: 'fa-award' };
            details.innerHTML += `
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid ${w.icon}" style="color: var(--accent-indigo);"></i>
                    <span>${w.name}</span>
                </div>
            `;
        });
    }
    document.getElementById('wingsModal').style.display = 'flex';
}

function openReportsModal(discordId) {
    const cadet = globalAllPolice.find(c => c.discordId === discordId);
    if (!cadet) return;

    const details = document.getElementById('reportsListDetails');
    details.innerHTML = '';

    if (!cadet.reports || cadet.reports.length === 0) {
        details.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">لا توجد تقارير مسجلة.</p>';
    } else {
        cadet.reports.forEach(r => {
            details.innerHTML += `
                <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 8px;">
                    <div style="font-weight: bold; color: var(--accent-amber);">${r.title}</div>
                    <div style="font-size: 13px; color: var(--text-primary); margin-top: 4px;">${r.content}</div>
                    <div style="font-size: 11px; color: var(--text-secondary); margin-top: 6px;">التاريخ: ${r.date}</div>
                </div>
            `;
        });
    }
    document.getElementById('reportsModal').style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function switchView(viewName, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.getElementById('viewAllPolice').style.display = 'none';
    document.getElementById('viewCadetsOnly').style.display = 'none';
    document.getElementById('viewUsers').style.display = 'none';
    document.getElementById('viewApproval').style.display = 'none';
    document.getElementById('viewLogs').style.display = 'none';

    if (viewName === 'allPolice') document.getElementById('viewAllPolice').style.display = 'block';
    if (viewName === 'cadetsOnly') document.getElementById('viewCadetsOnly').style.display = 'block';
    if (viewName === 'users') document.getElementById('viewUsers').style.display = 'block';
    if (viewName === 'approval') document.getElementById('viewApproval').style.display = 'block';
    if (viewName === 'logs') document.getElementById('viewLogs').style.display = 'block';
}
