const socket = io();

let currentAllPolice = [];
let currentCadets = [];
let currentUser = { username: '', copyId: '' };

// 1. إدارة تسجيل الدخول والتحقق من الجلسة
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const copyId = document.getElementById('loginCopyId').value.trim();

    try {
        const res = await fetch('/api/login-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, copyId })
        });
        const data = await res.json();

        if (data.approved) {
            currentUser = { username, copyId };
            document.getElementById('displayLoggedUser').innerText = username;
            document.getElementById('displayLoggedStatus').innerText = `معرّف: ${copyId}`;
            document.getElementById('loginModal').style.display = 'none';
        } else {
            document.getElementById('loginStatus').innerText = 'انتظار موافقة المسؤول...';
            document.getElementById('loginStatus').style.color = 'var(--accent-amber)';
        }
    } catch (err) {
        console.error('خطأ تسجيل الدخول:', err);
    }
});

// 2. استقبال بيانات الشرطة والستخدمين المحدثة عبر Socket.io
socket.on('policeDataUpdate', (data) => {
    currentAllPolice = data.allPolice || [];
    currentCadets = data.cadets || [];

    renderTable('allPoliceTableBody', currentAllPolice);
    renderTable('cadetsOnlyTableBody', currentCadets);
    updateStats(currentAllPolice);
});

socket.on('updateData', (data) => {
    if (!data || !data.police) return;

    const allMembers = Object.keys(data.police).map(id => ({
        discordId: id,
        ...data.police[id]
    }));

    currentAllPolice = allMembers;
    currentCadets = allMembers.filter(m => 
        m.rank && (m.rank.toLowerCase().includes('cadet') || m.rank.toLowerCase().includes('كاديت'))
    );

    renderTable('allPoliceTableBody', currentAllPolice);
    renderTable('cadetsOnlyTableBody', currentCadets);
    updateStats(currentAllPolice);
});

socket.on('usersUpdate', (users) => {
    renderUsersTable(users);
    renderApprovalList(users);
});

// 3. بناء الجدول وعرض البيانات والتاريخ والحالة
function renderTable(tableBodyId, list) {
    const tbody = document.getElementById(tableBodyId);
    if (!tbody) return;
    tbody.innerHTML = '';

    list.forEach(item => {
        const tr = document.createElement('tr');
        
        const hireDateDisplay = item.joinedDate || item.hireDate || "غير محدد";
        const daysCount = item.daysInPolice !== undefined ? item.daysInPolice : (item.daysPassed || 0);
        const joinedDateText = `${hireDateDisplay} <span style="font-size:11px; color:var(--text-secondary);">(${daysCount} يوم)</span>`;

        const statusBadge = item.disabled 
            ? `<span class="badge-status" style="color:var(--accent-red);"><span class="status-dot status-no-active"></span> معطّل</span>`
            : `<span class="badge-status" style="color:var(--accent-green);"><span class="status-dot status-active"></span> نشط</span>`;

        tr.innerHTML = `
            <td><strong>${item.callsign ? `[${item.callsign}] ` : ''}${item.name}</strong></td>
            <td><span class="unit-tag">${item.rank || 'Solo Cadet'}</span></td>
            <td>${joinedDateText}</td>
            <td>${item.hours || 0} ساعة</td>
            <td>${item.points || 0} نقطة</td>
            <td>
                <span class="badge-wings" style="cursor:pointer;" onclick="showWings('${item.discordId}')">
                    <i class="fa-solid fa-award"></i> ${item.wings ? item.wings.length : 0} وينقات
                </span>
            </td>
            <td>
                <button class="btn btn-primary" style="padding: 4px 8px; font-size:12px;" onclick="showReports('${item.discordId}')">
                    ${item.reports ? item.reports.length : 0} تقارير
                </button>
            </td>
            <td>${statusBadge}</td>
            <td style="text-align: center;">
                <button class="btn btn-warning" style="padding: 4px 10px; font-size:12px;" onclick="openEditModal('${item.discordId}')">
                    <i class="fa-solid fa-pen"></i> تعديل
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// 4. تحديث الإحصائيات العلويّة
function updateStats(policeList) {
    const statTotal = document.getElementById('statTotal');
    const statHours = document.getElementById('statHours');
    const statPoints = document.getElementById('statPoints');

    if (statTotal) statTotal.innerText = policeList.length;
    
    let totalHours = policeList.reduce((acc, curr) => acc + (parseFloat(curr.hours) || 0), 0);
    let totalPoints = policeList.reduce((acc, curr) => acc + (parseInt(curr.points) || 0), 0);

    if (statHours) statHours.innerText = totalHours.toFixed(1);
    if (statPoints) statPoints.innerText = totalPoints;
}

// 5. فتح نافذة التعديل وتعبئة البيانات بالكامل
function openEditModal(discordId) {
    const member = currentAllPolice.find(m => m.discordId === discordId);
    if (!member) return;

    document.getElementById('editDiscordId').value = member.discordId;
    document.getElementById('editHours').value = member.hours || 0;
    document.getElementById('editPoints').value = member.points || 0;
    document.getElementById('editDisabledStatus').value = member.disabled ? "true" : "false";
    
    document.getElementById('editReportTitle').value = '';
    document.getElementById('editReportContent').value = '';

    const memberWings = member.wings || [];
    const checkboxes = document.querySelectorAll('#wingsContainer input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = memberWings.includes(cb.value);
    });

    document.getElementById('editModal').style.display = 'flex';
}

// 6. حفظ التعديل وإرساله عبر API و Socket.io
document.getElementById('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const discordId = document.getElementById('editDiscordId').value;
    const hours = parseFloat(document.getElementById('editHours').value);
    const points = parseInt(document.getElementById('editPoints').value);
    const disabled = document.getElementById('editDisabledStatus').value === "true";
    
    const selectedWings = [];
    document.querySelectorAll('#wingsContainer input[type="checkbox"]:checked').forEach(cb => {
        selectedWings.push(cb.value);
    });

    const reportTitle = document.getElementById('editReportTitle').value.trim();
    const reportContent = document.getElementById('editReportContent').value.trim();

    const payload = {
        discordId,
        hours,
        points,
        disabled,
        wings: selectedWings,
        reportTitle,
        reportContent,
        updatedBy: currentUser.username || "المشرف"
    };

    // الإرسال للسيرفر عبر API مع بث عبر Socket
    try {
        await fetch('/api/update-member', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error("خطأ في تحديث البيانات:", err);
    }

    socket.emit('updateOfficer', payload);
    closeModal('editModal');
});

// 7. إغلاق النوافذ وإدارة التبويبات
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}

function switchView(viewName, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const views = ['viewAllPolice', 'viewCadetsOnly', 'viewUsers', 'viewApproval', 'viewLogs'];
    views.forEach(v => {
        const el = document.getElementById(v);
        if (el) el.style.display = 'none';
    });

    const targetView = document.getElementById(`view${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`);
    if (targetView) targetView.style.display = 'block';
}

// 8. عرض الوينقات والتقارير وحذف التقارير
function showWings(discordId) {
    const member = currentAllPolice.find(m => m.discordId === discordId);
    if (!member) return;

    const container = document.getElementById('wingsListDetails');
    container.innerHTML = '';

    if (member.wings && member.wings.length > 0) {
        member.wings.forEach(w => {
            const div = document.createElement('div');
            div.className = 'badge-wings';
            div.innerText = w;
            container.appendChild(div);
        });
    } else {
        container.innerHTML = '<p style="color:var(--text-secondary);">لا توجد وينقات مكتسبة.</p>';
    }

    document.getElementById('wingsModal').style.display = 'flex';
}

function showReports(discordId) {
    const member = currentAllPolice.find(m => m.discordId === discordId);
    if (!member) return;

    const container = document.getElementById('reportsListDetails');
    container.innerHTML = '';

    if (member.reports && member.reports.length > 0) {
        member.reports.forEach((rep, index) => {
            const div = document.createElement('div');
            div.style.cssText = 'background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:8px; border:1px solid var(--card-border); position:relative;';
            const text = rep.content || rep.details || rep.text || "بدون نص";
            
            div.innerHTML = `
                <div style="font-weight:bold; color:var(--accent-blue); font-size:13px;">${rep.title || 'تقرير MDT'}</div>
                <div style="font-size:12px; margin-top:4px; white-space:pre-line;">${text}</div>
                <div style="font-size:10px; color:var(--text-secondary); margin-top:5px;">التاريخ: ${rep.date || 'غير محدد'}</div>
                <button onclick="deleteReport('${discordId}', '${rep.id}', ${index})" style="position:absolute; left:10px; top:10px; background:var(--accent-red); color:#fff; border:none; border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer;">حذف</button>
            `;
            container.appendChild(div);
        });
    } else {
        container.innerHTML = '<p style="color:var(--text-secondary);">لا توجد تقارير مسجلة.</p>';
    }

    document.getElementById('reportsModal').style.display = 'flex';
}

function deleteReport(discordId, reportId, reportIndex) {
    if (confirm('هل أنت تأكد من حذف هذا التقرير؟')) {
        socket.emit('delete-report', { discordId, reportId, reportIndex });
        closeModal('reportsModal');
    }
}

// 9. إدارة المستخدمين والموافقات
function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${u.username}</td>
            <td>${u.copyId}</td>
            <td>${u.approved ? '<span style="color:var(--accent-green);">مقبول</span>' : '<span style="color:var(--accent-amber);">معلق</span>'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderApprovalList(users) {
    const container = document.getElementById('approvalList');
    if (!container) return;
    container.innerHTML = '';

    const pending = users.filter(u => !u.approved);

    if (pending.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);">لا توجد طلبات معلقة حالياً.</p>';
        return;
    }

    pending.forEach(u => {
        const div = document.createElement('div');
        div.style.cssText = 'background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;';
        div.innerHTML = `
            <div>
                <strong>${u.username}</strong>
                <span style="font-size:12px; color:var(--text-secondary); font-family:monospace;"> (${u.copyId})</span>
            </div>
            <div>
                <button class="btn btn-success" style="padding:4px 8px; font-size:12px; margin-left:5px;" onclick="approveUser('${u.copyId}')">قبول</button>
                <button class="btn btn-danger" style="padding:4px 8px; font-size:12px;" onclick="rejectUser('${u.copyId}')">رفض</button>
            </div>
        `;
        container.appendChild(div);
    });
}

function approveUser(copyId) {
    socket.emit('approve-user', copyId);
}

function rejectUser(copyId) {
    socket.emit('reject-user', copyId);
}
