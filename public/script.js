// =========================
// Socket.io (تحديث مباشر)
// =========================
const socket = io();

// كل ما يرسل السيرفر تحديث جديد
socket.on("cadetsUpdate", (data) => {
    allData = data;
    updateStats();
    renderTable();
});

// =========================
// المتغيرات الأساسية
// =========================
let allData = [];
let currentTab = 'active';

// =========================
// جلب البيانات أول مرة فقط
// =========================
async function fetchCadets() {
    try {
        const res = await fetch('/api/cadets');
        allData = await res.json();
        updateStats();
        renderTable();
    } catch (e) {
        console.error(e);
    }
}

// =========================
// تحديث الإحصائيات
// =========================
function updateStats() {
    const activeOnly = allData.filter(i => i.status === 'active');
    document.getElementById('statTotal').innerText = activeOnly.length;

    const totalH = activeOnly.reduce((acc, curr) => acc + (curr.hours || 0), 0);
    document.getElementById('statHours').innerText = totalH.toFixed(2).replace('.', ',');

    const totalR = activeOnly.reduce((acc, curr) => acc + (curr.reports ? curr.reports.length : 0), 0);
    document.getElementById('statReports').innerText = totalR;
}

// =========================
// عرض الجدول
// =========================
function renderTable() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    const filtered = allData.filter(item => item.status === currentTab);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding: 40px;">No data available in this section</td></tr>`;
        return;
    }

    filtered.forEach(item => {
        const rankClass = item.rank === 'Solo Cadet' ? 'solo-cadet' : 'cadet';
        const rankIcon = item.rank === 'Solo Cadet' ? 'fa-star' : 'fa-graduation-cap';

        const formattedHours = (item.hours || 0).toFixed(2).replace('.', ',');

        tbody.innerHTML += `
            <tr>
                <td>
                    <div class="officer-name">
                        <i class="fa-solid fa-user-circle" style="font-size: 20px; color: var(--text-secondary);"></i>
                        ${item.name}
                    </div>
                </td>
                <td><span class="badge-rank ${rankClass}"><i class="fa-solid ${rankIcon}"></i> ${item.rank}</span></td>
                <td><span class="hours-tag">${formattedHours}</span></td>
                <td><i class="fa-solid fa-file-alt" style="color:var(--text-secondary); margin-left: 5px;"></i> ${item.reports ? item.reports.length : 0}</td>
                <td>
                    <div class="actions" style="justify-content: center;">
                        <button class="btn-action btn-view" onclick="showReports('${item.discordId}')">
                            <i class="fa-solid fa-eye"></i> Reports
                        </button>
                        <button class="btn-action btn-edit" onclick="openEditModal('${item.discordId}')">
                            <i class="fa-solid fa-pen"></i> Edit / Add
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
}

// =========================
// التبديل بين التابات
// =========================
function switchTab(tab, btn) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderTable();
}

// =========================
// عرض التقارير
// =========================
function showReports(discordId) {
    const officer = allData.find(c => c.discordId === discordId);
    if (!officer) return;

    document.getElementById('modalOfficerName').innerText = `Officer Reports: ${officer.name}`;
    const reportsList = document.getElementById('modalReportsList');
    reportsList.innerHTML = '';

    if (!officer.reports || officer.reports.length === 0) {
        reportsList.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding: 20px;">No reports available for this officer.</p>';
    } else {
        officer.reports.forEach(rep => {
            reportsList.innerHTML += `
                <div style="background:rgba(15, 23, 42, 0.8); padding:12px 15px; border-radius:10px; margin-bottom:10px; border:1px solid var(--card-border);">
                    <div style="font-size:11px; color:var(--accent-blue); font-weight:700;">${rep.date}</div>
                    <div style="font-weight:700; margin-top:4px; font-size:14px;">${rep.title}</div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">${rep.content}</div>
                </div>
            `;
        });
    }

    document.getElementById('reportsModal').style.display = 'flex';
}

// =========================
// فتح نافذة التعديل
// =========================
function openEditModal(discordId) {
    const officer = allData.find(c => c.discordId === discordId);
    if (!officer) return;

    document.getElementById('editDiscordId').value = officer.discordId;
    document.getElementById('editOfficerName').innerText = `Edit Data: ${officer.name}`;
    document.getElementById('manualHours').value = officer.hours || 0;
    document.getElementById('manualReportTitle').value = '';
    document.getElementById('manualReportContent').value = '';

    document.getElementById('editModal').style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// =========================
// حفظ التعديلات اليدوية
// =========================
document.getElementById('manualEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const discordId = document.getElementById('editDiscordId').value;
    const hours = document.getElementById('manualHours').value;
    const reportTitle = document.getElementById('manualReportTitle').value;
    const reportContent = document.getElementById('manualReportContent').value;

    try {
        const res = await fetch('/api/update-cadet-manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discordId, hours, reportTitle, reportContent })
        });
        const data = await res.json();
        if (data.success) {
            closeModal('editModal');
        }
    } catch (err) {
        console.error(err);
    }
});

// =========================
// تشغيل أولي
// =========================
fetchCadets();
