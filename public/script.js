const socket = io();

let currentUser = null;
let availableWings = [];
let globalAllPolice = [];
let globalCadetsOnly = [];

// جلب قائمة الوينقات المتاحة من السيرفر (مع fallback في حال عدم توفر API)
fetch('/api/wings-list')
    .then(res => res.json())
    .then(data => { availableWings = data; })
    .catch(() => {
        availableWings = [
            { id: 'Air Support', name: 'Air Support (الأرشيب)', icon: 'fa-helicopter' },
            { id: 'Interceptor', name: 'Interceptor (الإنترسبتر)', icon: 'fa-car' },
            { id: 'Motorcycle', name: 'Motorcycle (الموتر سايكل)', icon: 'fa-motorcycle' },
            { id: 'Negotiation', name: 'Negotiation (التفاوض)', icon: 'fa-comments' },
            { id: 'Dispatch', name: 'Dispatch (الدسباتش)', icon: 'fa-headset' }
        ];
    });

// نموذج تسجيل الدخول
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const copyId = document.getElementById('loginCopyId').value.trim();
    const statusDiv = document.getElementById('loginStatus');

    if (statusDiv) {
        statusDiv.style.color = '#f59e0b';
        statusDiv.textContent = 'جاري التحقق من الطلب...';
    }

    try {
        const res = await fetch('/api/login-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, copyId })
        });

        const data = await res.json();
        currentUser = { username, copyId, approved: data.approved };

        if (data.approved) {
            document.getElementById('loginModal').style.display = 'none';
            document.getElementById('displayLoggedUser').textContent = username;
            document.getElementById('displayLoggedStatus').textContent = `معرّف: ${copyId}`;
            startHeartbeat();
        } else if (statusDiv) {
            statusDiv.style.color = '#ef4444';
            statusDiv.textContent = 'في انتظار موافقة المسؤول لتسجيل الدخول...';
        }
    } catch (err) {
        console.error("خطأ تسجيل الدخول:", err);
    }
});

function startHeartbeat() {
    setInterval(() => {
        if (currentUser && currentUser.approved) {
            fetch('/api/user-heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ copyId: currentUser.copyId })
            }).catch(() => {});
        }
    }, 15000);
}

// الاستماع لتحديثات بيانات الشرطة من السيرفر
socket.on('policeDataUpdate', (data) => {
    globalAllPolice = data.allPolice || [];
    globalCadetsOnly = data.cadets || [];

    renderTableRows('allPoliceTableBody', globalAllPolice);
    renderTableRows('cadetsOnlyTableBody', globalCadetsOnly);
    updateStats(globalAllPolice);
});

// الاستماع لتحديثات المستخدمين المتواجدين
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

// الاستماع لتحديثات السجلات (Logs)
socket.on('logsUpdate', (logs) => {
    renderLogs(logs);
});

// بناء أسطر جداول العسكريين مع إضافة التاريخ والأيام
function renderTableRows(tableBodyId, dataList) {
    const tbody = document.getElementById(tableBodyId);
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!dataList || dataList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color: var(--text-secondary);">لا يوجد أعضاء في هذه القائمة</td></tr>';
        return;
    }

    dataList.forEach(c => {
        const wingsCount = c.wingsCount || (c.wings || []).length;
        const reportsCount = (c.reports || []).length;
        const unitTag = c.unit ? `<span class="unit-tag">${c.unit}</span>` : '';
        
        // حساب وصياغة التاريخ
        const joinedDateText = c.joinedDate 
            ? `${c.joinedDate} <span style="font-size:11px; color:var(--text-secondary);">(${c.daysInPolice || 0} يوم)</span>`
            : "غير محدد";

        // إعداد شارة الحالة
        const isDisabled = c.disabled === true || c.disabled === 'true';
        const statusBadge = isDisabled 
            ? '<span class="badge-status" style="background: rgba(239, 68, 68, 0.2); color: var(--accent-red);"><span class="status-dot status-no-active"></span>معطّل</span>'
            : '<span class="badge-status" style="background: rgba(16, 185, 129, 0.2); color: var(--accent-green);"><span class="status-dot status-active"></span>نشط</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align: right;">${unitTag} <b>${c.name}</b></td>
            <td><span style="background: rgba(56, 189, 248, 0.1); color: var(--accent-blue); padding: 4px 8px; border-radius: 6px; font-weight: bold;">${c.rank}</span></td>
            <td>${joinedDateText}</td>
            <td>${c.hours} ساعة</td>
            <td>${c.points} نقطة</td>
            <td><button class="badge-wings" onclick="openWingsModal('${c.discordId}')">${wingsCount} وينق/ات</button></td>
            <td><button class="badge-wings" style="background: rgba(245, 158, 11, 0.2); color: #fde68a;" onclick="openReportsModal('${c.discordId}')">${reportsCount} تقارير</button></td>
            <td>${statusBadge}</td>
            <td style="text-align: center;">
                <button class="btn btn-primary" style="padding: 5px 10px; font-size: 12px;" onclick="openEditModal('${c.discordId}')"><i class="fa-solid fa-pen"></i> تعديل</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// تحديث الإحصائيات الشاملة
function updateStats(allPolice) {
    const totalEl = document.getElementById('statTotal');
    const hoursEl = document.getElementById('statHours');
    const pointsEl = document.getElementById('statPoints');

    if (totalEl) totalEl.textContent = allPolice.length;
    
    const totalHours = allPolice.reduce((acc, c) => acc + (parseFloat(c.hours) || 0), 0);
    const totalPoints = allPolice.reduce((acc, c) => acc + (parseInt(c.points) || 0), 0);

    if (hoursEl) hoursEl.textContent = totalHours.toFixed(1);
    if (pointsEl) pointsEl.textContent = totalPoints;
}

// عرض المتواجدين بالموقع
function renderUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    (users || []).forEach(u => {
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

// عرض طلبات الموافقة المعلقة
function renderApprovals(users) {
    const tbody = document.getElementById('approvalTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const pending = (users || []).filter(u => !u.approved);
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

// عرض سجل التغييرات
function renderLogs(logs) {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    (logs || []).forEach(l => {
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

// إرسال قرار قبول/رفض مستخدم عبر Socket.io
function approveUser(copyId, approve) {
    if (approve) {
        socket.emit('approve-user', copyId);
    } else {
        socket.emit('reject-user', copyId);
    }
}

// فتح نافذة التعديل
function openEditModal(discordId) {
    const cadet = globalAllPolice.find(c => c.discordId === discordId);
    if (!cadet) return;

    document.getElementById('editDiscordId').value = cadet.discordId;
    document.getElementById('editHours').value = cadet.hours || 0;
    document.getElementById('editPoints').value = cadet.points || 0;
    
    const disabledElem = document.getElementById('editDisabledStatus');
    if (disabledElem) disabledElem.value = cadet.disabled ? "true" : "false";

    // إعادة بناء checkboxes الوينقات
    const wingsContainer = document.getElementById('wingsContainer');
    if (wingsContainer) {
        wingsContainer.innerHTML = '';
        availableWings.forEach(w => {
            const isChecked = (cadet.wings || []).includes(w.name || w.id) || (cadet.wings || []).includes(w.id) ? 'checked' : '';
            wingsContainer.innerHTML += `
                <label>
                    <input type="checkbox" value="${w.name || w.id}" ${isChecked}>
                    <i class="fa-solid ${w.icon || 'fa-award'}"></i> ${w.name || w.id}
                </label>
            `;
        });
    }

    // تصفير خانات التقرير
    document.getElementById('editReportTitle').value = '';
    document.getElementById('editReportContent').value = '';

    document.getElementById('editModal').style.display = 'flex';
}

// إرسال التعديلات للسيرفر بنجاح
document.getElementById('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const discordId = document.getElementById('editDiscordId').value;
    const hours = parseFloat(document.getElementById('editHours').value) || 0;
    const points = parseInt(document.getElementById('editPoints').value) || 0;
    const reportTitle = document.getElementById('editReportTitle').value.trim();
    const reportContent = document.getElementById('editReportContent').value.trim();

    const payload = {
        discordId,
        hours,
        points
    };

    if (reportTitle || reportContent) {
        payload.newReport = {
            title: reportTitle || "تقرير MDT",
            details: reportContent || "تقرير بدون تفاصيل"
        };
    }

    try {
        const res = await fetch('/api/update-member', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
            closeModal('editModal');
        } else {
            alert('تعذر حفظ البيانات، يرجى المحاولة لاحقاً');
        }
    } catch (err) {
        console.error("خطأ في حفظ البيانات:", err);
    }
});

// فتح مودال عرض الوينقات
function openWingsModal(discordId) {
    const cadet = globalAllPolice.find(c => c.discordId === discordId);
    if (!cadet) return;

    const details = document.getElementById('wingsListDetails');
    if (!details) return;
    details.innerHTML = '';

    if (!cadet.wings || cadet.wings.length === 0) {
        details.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">لا توجد وينقات مكتسبة.</p>';
    } else {
        cadet.wings.forEach(wItem => {
            const wName = typeof wItem === 'string' ? wItem : wItem.name;
            details.innerHTML += `
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid fa-award" style="color: var(--accent-indigo);"></i>
                    <span>${wName}</span>
                </div>
            `;
        });
    }
    document.getElementById('wingsModal').style.display = 'flex';
}

// فتح مودال عرض التقارير
function openReportsModal(discordId) {
    const cadet = globalAllPolice.find(c => c.discordId === discordId);
    if (!cadet) return;

    const details = document.getElementById('reportsListDetails');
    if (!details) return;
    details.innerHTML = '';

    if (!cadet.reports || cadet.reports.length === 0) {
        details.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">لا توجد تقارير مسجلة.</p>';
    } else {
        cadet.reports.forEach(r => {
            const textContent = r.details || r.text || r.content || r.description || "بدون نص تفصيلي";
            details.innerHTML += `
                <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 8px;">
                    <div style="font-weight: bold; color: var(--accent-amber);">${r.title || 'تقرير MDT'}</div>
                    <div style="font-size: 13px; color: var(--text-primary); margin-top: 4px; white-space: pre-line;">${textContent}</div>
                    <div style="font-size: 11px; color: var(--text-secondary); margin-top: 6px;">التاريخ: ${r.date || 'غير محدد'}</div>
                </div>
            `;
        });
    }
    document.getElementById('reportsModal').style.display = 'flex';
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
}

// التبديل بين التبويبات
function switchView(viewName, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const views = ['viewAllPolice', 'viewCadetsOnly', 'viewUsers', 'viewApproval', 'viewLogs'];
    views.forEach(v => {
        const elem = document.getElementById(v);
        if (elem) elem.style.display = 'none';
    });

    if (viewName === 'allPolice') document.getElementById('viewAllPolice').style.display = 'block';
    if (viewName === 'cadetsOnly') document.getElementById('viewCadetsOnly').style.display = 'block';
    if (viewName === 'users') document.getElementById('viewUsers').style.display = 'block';
    if (viewName === 'approval') document.getElementById('viewApproval').style.display = 'block';
    if (viewName === 'logs') document.getElementById('viewLogs').style.display = 'block';
}
