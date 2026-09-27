/* ============================================================================
   نظام إدارة الشرطة — Front-end
   ==========================================================================*/
'use strict';

const socket = io({ auth: {} });

/* ------------------------------ الحالة ------------------------------ */
const S = {
    token: localStorage.getItem('pd_token') || '',
    account: null,
    isAdmin: false,
    officers: [],
    presence: [],
    accounts: [],
    logs: [],
    view: 'affairs',
    certDefs: {},   // تعبّأ من السيرفر عبر /api/meta
    botOnline: false,
    guildName: null,
    ranks: [],      // رتبة رتب الديسكورد بالترتيب اللي حدده المشرف
    duties: [],     // المسؤوليات
    allRoles: []    // كل الأدوار (رتبة/شهادة/مسؤولية)
};

/* ------------------------------ أدوات ------------------------------ */
const $ = id => document.getElementById(id);
const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2);
    return (parts[0][0] || '') + (parts[1][0] || '');
}
function avatar(o, cls = 'ava') {
    if (o.avatar) return `<img class="${cls}" src="${esc(o.avatar)}" alt="" loading="lazy">`;
    return `<div class="${cls}">${esc(initials(o.charName || o.name || o.username))}</div>`;
}
function arabicNum(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    return Number.isInteger(v) ? v.toLocaleString('ar-SA') : v.toLocaleString('ar-SA', { maximumFractionDigits: 2 });
}
function fmtDT(ts) {
    if (!ts) return '—';
    try {
        return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: true
        }).format(new Date(ts));
    } catch { return '—'; }
}
function fmtRel(ts) {
    if (!ts) return 'لم يدخل بعد';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'الحين';
    if (s < 3600) return `قبل ${Math.floor(s / 60)} دقيقة`;
    if (s < 86400) return `قبل ${Math.floor(s / 3600)} ساعة`;
    if (s < 604800) return `قبل ${Math.floor(s / 86400)} يوم`;
    return fmtDT(ts);
}
function ago(secs) {
    if (secs == null) return '—';
    if (secs < 60) return `${Math.floor(secs / 60)} دقيقة`;
    if (secs < 3600) return `${Math.floor(secs / 3600)} ساعة`;
    return `${Math.floor(secs / 86400)} يوم`;
}

/** يطبّع النص للبحث: يحذف التشكيل وعلامات الترقيم والمسافات الزايدة */
function norm(s) {
    return String(s ?? '')
        .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}
function fold(s) { return norm(s).replace(/\s+/g, ''); }

/** بحث ذكي: يطابق الباچ أو الاسم أو أول حرف */
function matchQ(o, q) {
    if (!q) return true;
    const hay = fold([
        o.name, o.callsign, o.charName, o.oocName, o.username, o.tag,
        o.rank, o.rankAr, ...(o.certifications || []).map(c => `${c.ar} ${c.name}`)
    ].join(' '));
    return fold(q).split(/\s+/).every(t => hay.includes(fold(t)));
}

function toast(msg, kind = 'info', ms = 3200) {
    const ic = { ok: 'fa-circle-check', err: 'fa-circle-xmark', info: 'fa-circle-info' }[kind] || 'fa-circle-info';
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `<i class="fa-solid ${ic}"></i><span>${esc(msg)}</span>`;
    $('toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

async function api(path, { method = 'GET', body, admin } = {}) {
    const res = await fetch(path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(S.token ? { 'x-auth-token': S.token } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch { }
    if (!res.ok) {
        if (res.status === 401) { hardLogout(data.message || 'انتهت الجلسة'); }
        const e = new Error(data.message || `خطأ ${res.status}`);
        e.code = data.error; e.status = res.status;
        throw e;
    }
    return data;
}

/* ------------------------------ النوافذ ------------------------------ */
function openOv(id) { $(id).classList.add('on'); document.body.style.overflow = 'hidden'; }
function closeOv(id) { $(id).classList.remove('on'); if (!qa('.ov.on').length) document.body.style.overflow = ''; }
function closeAllOv() { qa('.ov').forEach(o => o.classList.remove('on')); document.body.style.overflow = ''; }

qa('[data-close]').forEach(b => b.addEventListener('click', () => closeOv(b.closest('.ov').id)));
qa('.ov').forEach(ov => ov.addEventListener('mousedown', e => { if (e.target === ov) closeOv(ov.id); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllOv(); });

/* ------------------------------ الدخول ------------------------------ */
function hardLogout(msg) {
    S.token = ''; S.account = null;
    localStorage.removeItem('pd_token');
    socket.auth = {};
    socket.disconnect();
    $('shell').classList.remove('on');
    $('gate').classList.remove('gone');
    $('lMsg').innerHTML = msg ? `<div class="msg msg-info"><i class="fa-solid fa-circle-info"></i><span>${esc(msg)}</span></div>` : '';
}
function showShell() {
    $('gate').classList.add('gone');
    $('shell').classList.add('on');
    renderMe();
    loadAll();
    connectLive();
}
function renderMe() {
    const a = S.account;
    if (!a) return;
    $('meName').textContent = a.charName || a.username;
    $('meMeta').textContent = a.isAdmin ? 'مشرف النظام' : (a.canEdit ? 'صلاحية تعديل' : 'عرض فقط');
    $('meAva').outerHTML = a.avatar
        ? `<img class="ava" id="meAva" src="${esc(a.avatar)}" alt="">`
        : `<div class="ava" id="meAva">${esc(initials(a.charName))}</div>`;
    $('btnRefresh').classList.toggle('hide', !a.isAdmin);
}

$('segLogin').addEventListener('click', () => {
    $('segLogin').classList.add('on'); $('segReg').classList.remove('on');
    $('formLogin').classList.remove('hide'); $('formReg').classList.add('hide');
});
$('segReg').addEventListener('click', () => {
    $('segReg').classList.add('on'); $('segLogin').classList.remove('on');
    $('formReg').classList.remove('hide'); $('formLogin').classList.add('hide');
});

function showMsg(el, text, kind = 'err') {
    const ic = { err: 'fa-circle-exclamation', ok: 'fa-circle-check', info: 'fa-circle-info', warn: 'fa-circle-exclamation' }[kind];
    el.innerHTML = `<div class="msg msg-${kind}"><i class="fa-solid ${ic}"></i><span>${esc(text)}</span></div>`;
}

$('formLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const copyId = $('lCopy').value.trim();
    const token = $('lToken').value.trim();
    if (!copyId && !token) return showMsg($('lMsg'), 'اكتب كوبى آى دى');
    $('lMsg').innerHTML = '';
    checkBotHealth();
    try {
        const r = await api('/api/auth/login', { method: 'POST', body: { copyId, token } });
        afterAuth(r);
    } catch (err) {
        if (err.code === 'pending') {
            showMsg($('lMsg'), err.message, 'warn');
        } else if (err.code === 'not-registered') {
            showMsg($('lMsg'), err.message, 'warn');
            $('segReg').click();
        } else {
            showMsg($('lMsg'), err.message, 'err');
        }
    }
});

$('formReg').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.innerHTML = '<span class="load"></span> جاري التحقق…';
    $('rMsg').innerHTML = '';
    try {
        const r = await api('/api/auth/register', {
            method: 'POST',
            body: {
                username: $('rUser').value.trim(),
                charName: $('rChar').value.trim(),
                email: $('rMail').value.trim(),
                copyId: $('rCopy').value.trim()
            }
        });
        if (r.status === 'approved') {
            showMsg($('rMsg'), 'تم التحقق والدخول ✓', 'ok');
            afterAuth(r);
        } else {
            showMsg($('rMsg'), 'تم التحقق من حسابك بنجاح ✓ — طلبك بانتظار موافقة المشرف، أرجع بعد شوي.', 'warn');
            $('segLogin').click();
        }
    } catch (err) {
        showMsg($('rMsg'), err.message, 'err');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> تحقّق وتسجيل';
    }
});

function afterAuth(r) {
    S.token = r.token;
    S.account = r.account;
    S.isAdmin = !!r.account.isAdmin;
    localStorage.setItem('pd_token', r.token);
    socket.auth = { token: r.token };
    if (socket.connected) {
        socket.emit('auth', { token: r.token });
    } else {
        socket.connect();   // كان مفصول لو انت طلعنا — نرجّعه
    }
    showShell();
}

$('btnLogout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { }
    hardLogout('تم تسجيل خروجك.');
});

/* ------------------------------ تشخيص حالة البوت ------------------------------ */
/* يفحص البوت ويقول بالضبط وش المشكلة — بدل ما نخمن */
async function checkBotHealth() {
    let d;
    try {
        const r = await fetch('/api/health');
        d = await r.json();
    } catch { return; }

    const box = $('botWarn');
    const problems = [];

    if (!d.botReady) {
        problems.push({
            t: 'البوت ما قدر يتصل بالديسكورد',
            d: d.loginError
                ? `السبب: ${d.loginError}`
                : 'تأكد إن متغيّر BOT_TOKEN صحيح على السيرفر.',
            f: 'راجع المفاتيح (Environment) في Render وأعد التشغيل (Restart).'
        });
    } else if (!d.activeGuildId) {
        problems.push({
            t: 'البوت متصل بس مو داخل سيرفر الشرطة',
            d: 'ضيف البوت لسيرفر الشرطة من رابط الدعوة وحيّطه بصلاحية View Server.',
            f: ''
        });
    } else if (d.guildMatchedConfig === false) {
        problems.push({
            t: `البوت داخل "${d.activeGuildName}" بس مو السيرفر المضبوط`,
            d: `المضبوط حالياً: ${d.configuredGuildIds.join(', ')}`,
            f: `حط المتغيّر GUILD_ID = ${d.activeGuildId}`
        });
    }

    if (!problems.length) { box.classList.add('hide'); return; }

    box.innerHTML = problems.map(p => `
        <div class="msg msg-warn" style="flex-direction:column;gap:7px;align-items:stretch">
            <div style="display:flex;gap:9px;align-items:center;font-weight:800">
                <i class="fa-solid fa-triangle-exclamation"></i><span>${esc(p.t)}</span>
            </div>
            <div style="font-size:12.5px;opacity:.9;line-height:1.7">${esc(p.d)}</div>
            ${p.f ? `<div class="mono" style="font-size:11.5px;background:rgba(0,0,0,.35);padding:7px 10px;border-radius:6px;word-break:break-all">${esc(p.f)}</div>` : ''}
        </div>`).join('') +
        `<details style="margin-top:9px;font-size:12px;color:var(--tx-3)">
            <summary style="cursor:pointer">كل السيرفرات اللي البوت داخلها</summary>
            <div class="mono" style="margin-top:7px;line-height:2;font-size:11.5px">
                ${(d.botGuilds || []).map(g => `${esc(g.name)} → ${esc(g.id)}`).join('<br>') || 'ما لقى أي سيرفر'}
            </div>
        </details>`;
    box.classList.remove('hide');
}

/* ------------------------------ الاتصال اللحظي ------------------------------ */
function connectLive() {
    if (socket.connected) { socket.auth = { token: S.token }; socket.emit('auth', { token: S.token }); }
    socket.emit('page', S.view);
}
socket.on('connect', () => { setLive(true); connectLive(); });
socket.on('disconnect', () => setLive(false));
socket.on('connect_error', () => setLive(false));
socket.on('presence:update', list => { S.presence = list || []; renderOnline(); renderStats(); });
socket.on('accounts:update', list => { S.accounts = list || []; renderAccounts(); renderStats(); });
socket.on('officers:update', d => { if (d && d.officers) { S.officers = d.officers; renderAll(); } });

function setLive(on) {
    const b = $('liveBox');
    b.classList.toggle('off', !on);
    $('liveTxt').textContent = on ? 'متصل لحظي' : 'غير متصل';
}
setInterval(() => { if (S.token && socket.connected) socket.emit('ping:site'); }, 25000);

// شبكة أمان: لو ضاعت رسالة من السوكيت، نجدّد البيانات كل فترة
let lastOfficersAt = 0;
setInterval(async () => {
    if (!S.token || !S.account || document.hidden) return;
    if (Date.now() - lastOfficersAt < 45000) return;
    lastOfficersAt = Date.now();
    try {
        const r = await api('/api/officers');
        if (r.officers && JSON.stringify(r.officers) !== JSON.stringify(S.officers)) {
            S.officers = r.officers;
            renderAll();
        }
    } catch { }
}, 50000);

qa('#tabs .tab').forEach(t => t.addEventListener('click', () => {
    S.view = t.dataset.v;
    qa('#tabs .tab').forEach(x => x.classList.toggle('on', x === t));
    qa('section.panel').forEach(p => p.classList.toggle('hide', p.id !== 'v-' + S.view));
    if (socket.connected) socket.emit('page', S.view);
}));

/* ------------------------------ تحميل البيانات ------------------------------ */
async function loadAll() {
    try {
        const [off, acc] = await Promise.all([
            api('/api/officers'),
            api('/api/accounts')
        ]);
        S.officers = off.officers || [];
        S.accounts = acc.accounts || [];
        S.botOnline = !!off.botOnline;
        S.guildName = off.guildName || null;
        if (off.guildName) $('guildTag').textContent = `${off.guildName} • ${off.officers.length} فرد مسجّل`;
        else $('guildTag').textContent = S.botOnline ? 'جارٍ المزامنة…' : 'البوت غير متصل بالديسكورد';
        fillRankFilters();
        renderAll();
        if (S.isAdmin) loadLogs();
        loadRanks();
    } catch (e) {
        toast(e.message, 'err');
    }
}
async function loadLogs() {
    try { S.logs = (await api('/api/logs')).logs || []; renderLogs(); } catch { }
}

function fillRankFilters() {
    const ranks = [...new Set(S.officers.map(o => o.rank).filter(Boolean))].sort();
    for (const [id, list] of [['fRankA', ranks], ['fRankC', ranks]]) {
        const sel = $(id);
        const cur = sel.value;
        sel.innerHTML = '<option value="">كل الرتب</option>' +
            list.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
        sel.value = cur;
    }
}

/* ------------------------------ الإحصاء ------------------------------ */
/** أعلى رتبة حالية — ومن يحملها */
function topRank() {
    const withRank = S.officers.filter(o => o.rank && o.rank !== '—' && o.rankLevel < 9999);
    if (!withRank.length) return null;
    const best = withRank.reduce((a, b) => (b.rankLevel < a.rankLevel ? b : a));
    const holders = withRank.filter(o => o.rankLevel === best.rankLevel);
    return { name: best.rank, level: best.rankLevel, holders, count: holders.length };
}

function renderStats() {
    const all = S.officers;
    $('sOfficers').textContent = arabicNum(all.length);
    $('sCadets').textContent = arabicNum(all.filter(o => o.isCadet).length);
    $('sHours').textContent = arabicNum(all.reduce((a, o) => a + (+o.hours || 0), 0).toFixed(1));
    $('sPoints').textContent = arabicNum(all.reduce((a, o) => a + (+o.points || 0), 0));
    $('sReports').textContent = arabicNum(all.reduce((a, o) => a + (+o.reportsCount || 0), 0));

    const top = topRank();
    S.topLevel = top ? top.level : null;
    $('cardTopRank').style.display = top ? '' : 'none';
    if (top) {
        $('sTopRank').textContent = top.name;
        $('sTopHolders').textContent = arabicNum(top.count);
    }

    const on = S.presence.filter(p => p.online).length;
    $('sOnline').textContent = arabicNum(on);
    $('cAffairs').textContent = arabicNum(all.length);
    $('cAcademy').textContent = arabicNum(all.filter(o => o.isCadet).length);
    $('cOnline').textContent = arabicNum(on);

    const pend = S.accounts.filter(a => a.status === 'pending').length;
    $('cAccounts').textContent = arabicNum(S.accounts.length);
    $('cAccounts').classList.toggle('alert', pend > 0);
}

function renderAll() {
    renderStats();
    renderAffairs();
    renderAcademy();
    renderOnline();
    renderAccounts();
    renderLogs();
}

/* ------------------------------ شريط البحث ------------------------------ */
function bindSearch(boxId, onChange) {
    const box = $(boxId);
    const inp = box.querySelector('input');
    inp.addEventListener('input', () => {
        box.classList.toggle('has', !!inp.value);
        onChange(inp.value);
    });
    box.querySelector('.clr').addEventListener('click', () => {
        inp.value = ''; box.classList.remove('has'); onChange(''); inp.focus();
    });
}
const srchA = () => $('srchAffairs').querySelector('input').value;
const srchC = () => $('srchAcademy').querySelector('input').value;
const srchOn = () => $('srchOnline').querySelector('input').value;
const srchAcc = () => $('srchAcc').querySelector('input').value;
['fRankA', 'fStatA', 'fSortA'].forEach(id => $(id).addEventListener('change', renderAffairs));
['fRankC', 'fSortC'].forEach(id => $(id).addEventListener('change', renderAcademy));
['fStatOn'].forEach(id => $(id).addEventListener('change', renderOnline));
['fStatAcc'].forEach(id => $(id).addEventListener('change', renderAccounts));
bindSearch('srchAffairs', renderAffairs);
bindSearch('srchAcademy', renderAcademy);
bindSearch('srchOnline', renderOnline);
bindSearch('srchAcc', renderAccounts);
bindSearch('srchRoles', () => renderRanks(S.allRoles || []));

/* ------------------------------ خلايا مشتركة ------------------------------ */
function certChips(list, limit = 6) {
    const certs = list || [];
    if (!certs.length) return '<span class="tag mute">—</span>';
    const show = certs.slice(0, limit).map(c =>
        `<span class="cert has" style="background:${esc(c.color || '#d9b45b')}" title="${esc(c.ar)} — ${esc(c.name)}"><i class="fa-solid ${esc(c.icon || 'fa-award')}"></i></span>`).join('');
    const rest = certs.length - limit;
    return `<div class="certs">${show}${rest > 0 ? `<span class="cert" title="${rest} قسم آخر">+${rest}</span>` : ''}</div>`;
}
/** خلية النقاط — مع مؤشّر الخصم数和 عدد الـ Strikes */
function pointsCell(o) {
    const lc = o.lastPointsChange;
    let badge = '';
    if (o.strikeCount > 0) {
        badge += ` <span class="tag bad" style="font-size:10px;padding:2px 7px" title="${arabicNum(o.strikeCount)} استرايك — آخرها ${esc(fmtDT(o.lastStrikeAt))}">
            <i class="fa-solid fa-gavel"></i> ${arabicNum(o.strikeCount)}</span>`;
    } else if (lc && lc.delta < 0) {
        badge += ` <span class="tag bad" style="font-size:10px;padding:2px 7px" title="آخر خصم: ${esc(lc.reason || '')}">
            <i class="fa-solid fa-arrow-down"></i> ${arabicNum(Math.abs(lc.delta))}</span>`;
    } else if (lc && lc.delta > 0) {
        badge += ` <span class="tag ok" style="font-size:10px;padding:2px 7px" title="آخر إضافة: ${esc(lc.reason || '')}">
            <i class="fa-solid fa-arrow-up"></i> ${arabicNum(lc.delta)}</span>`;
    }
    return `<span class="pill star num">${arabicNum(o.points)}<u>نقطة</u></span>${badge}`;
}

function statusTag(st) {
    if (st === 'suspended') return '<span class="tag bad"><i class="fa-solid fa-ban"></i> موقوف</span>';
    if (st === 'leave') return '<span class="tag leave"><i class="fa-solid fa-plane"></i> إجازة</span>';
    return '<span class="tag ok"><i class="fa-solid fa-circle-check"></i> نشط</span>';
}
function rankTag(o) {
    const t = o.rankIsCustom
        ? `<span class="tag rank"><i class="fa-solid fa-pen"></i> ${esc(o.rank)}</span>`
        : `<span class="tag rank">${esc(o.rank)}</span>`;
    return o.isCadet ? t + ' <span class="tag cadet"><i class="fa-solid fa-graduation-cap"></i> أكاديمية</span>' : t;
}

/** شارات المسؤوليات — أي روم غير رتبة ولا شهادة */
function dutyChips(list) {
    const ds = list || [];
    if (!ds.length) return '<span class="tag mute">—</span>';
    const show = ds.slice(0, 3).map(d =>
        `<span class="tag" style="background:var(--vio-bg);color:#c4b5fd;border-color:rgba(167,139,250,.28)" title="${esc(d.name)}">${esc(d.name)}</span>`).join(' ');
    const rest = ds.length - 3;
    return show + (rest > 0 ? ` <span class="tag mute" title="${ds.slice(3).map(d => d.name).join('، ')}">+${rest}</span>` : '');
}

/** قائمة اختيار الرتبة — تظهر للمشرف داخل الجدول */
function rankSelect(o) {
    if (!S.isAdmin || !S.ranks.length) return rankTag(o);
    const opts = S.ranks.map(r =>
        `<option value="${esc(r.id)}"${r.id === o.rankRoleId ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
    return `<select class="sel ranksel" data-officer="${esc(o.id)}" title="غيّر الرتبة من هنا — تتعدل بالديسكورد">
        <option value="">— بدون رتبة —</option>${opts}
    </select>${o.rankIsCustom ? ' <span class="tag rank" title="رتبة مخصّصة من الموقع"><i class="fa-solid fa-pen"></i></span>' : ''}`;
}

/** تاج أعلى رتبة */
function topCrown(o) {
    if (S.topLevel === null || o.rankLevel !== S.topLevel || o.rank === '—') return '';
    return `<span class="crown" title="أعلى رتبة بالشرطة"><i class="fa-solid fa-crown"></i></span>`;
}
function emptyRow(cols, ic, title, sub) {
    return `<tr><td colspan="${cols}"><div class="empty"><i class="fa-solid ${ic}"></i><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div></td></tr>`;
}

/** رسالة واضحة بدل ما يبقى سهم يدور للأبد */
function noDataRow(cols) {
    if (S.botOnline) {
        return loadRow(cols).replace('<span class="load"></span>',
            `<i class="fa-solid fa-spinner"></i><b>جاري قراءة أفراد الشرطة…</b><span>ثواني وتظهر عندك</span>`);
    }
    return emptyRow(cols, 'fa-plug-circle-xmark', 'البوت غير متصل بالديسكورد',
        'شوف التنبيه فوق صفحة الدخول — بيقولك بالضبط وش ناقص');
}
function loadRow(cols) {
    return `<tr><td colspan="${cols}"><div class="empty"><span class="load"></span></div></td></tr>`;
}

/* ------------------------------ قسم الشؤون ------------------------------ */
function renderAffairs() {
    const tb = $('tbAffairs');
    const q = srchA();
    const fRank = $('fRankA').value, fStat = $('fStatA').value, sort = $('fSortA').value;

    let list = S.officers.filter(o => matchQ(o, q));
    if (fRank) list = list.filter(o => o.rank === fRank);
    if (fStat) list = list.filter(o => o.status === fStat);

    const cmp = {
        rank: (a, b) => (a.rankLevel - b.rankLevel) || a.name.localeCompare(b.name, 'ar'),
        name: (a, b) => a.name.localeCompare(b.name, 'ar'),
        points: (a, b) => b.points - a.points,
        hours: (a, b) => b.hours - a.hours,
        days: (a, b) => b.daysInService - a.daysInService
    }[sort];
    list = list.slice().sort(cmp);

    $('affairsSub').textContent = list.length === S.officers.length
        ? `جميع أفراد الشرطة — ${S.officers.length}`
        : `مفلتر: ${list.length} من ${S.officers.length}`;

    if (!S.officers.length) { tb.innerHTML = noDataRow(10); return; }
    if (!list.length) { tb.innerHTML = emptyRow(10, 'fa-magnifying-glass', 'ما فيه نتائج', 'جرّب كلمة ثانية'); return; }

    tb.innerHTML = list.map(o => `
    <tr>
        <td>
            <div class="who">
                ${avatar(o)}
                <div class="nm">
                    <b onclick="openProfile('${o.id}')" title="اضغط لعرض الملف الكامل">${esc(o.name)}</b>
                    <div class="mt">
                        ${o.callsign ? `<span class="tag badge">${esc(o.callsign)}</span>` : ''}
                        ${o.onSite ? '<span class="tag ok" title="داخل الموقع الحين"><i class="fa-solid fa-circle" style="font-size:6px"></i></span>' : ''}
                        <span>${esc(o.charName && o.charName !== o.name ? o.charName : (o.id.slice(0, 6) + '…'))}</span>
                    </div>
                </div>
            </div>
        </td>
        <td>${topCrown(o)} ${rankSelect(o)}</td>
        <td>
            <div class="num">${esc(fmtDT(o.joinTs))}</div>
            <div style="font-size:10.5px;color:var(--tx-3)">${arabicNum(o.daysInService)} يوم بالخدمة</div>
        </td>
        <td class="num-c"><span class="pill num">${arabicNum((+o.hours || 0).toFixed(1))}<u>س</u></span></td>
        <td class="num-c">${pointsCell(o)}</td>
        <td>${certChips(o.certifications)}</td>
        <td>${dutyChips(o.duties)}</td>
        <td class="num-c">
            <button class="pill num" style="cursor:pointer;border:1px solid var(--line-2)" onclick="openProfile('${o.id}')">
                <i class="fa-solid fa-file-lines" style="font-size:10px"></i>${arabicNum(o.reportsCount)}
            </button>
        </td>
        <td>${statusTag(o.status)}</td>
        <td>
            <div class="rowacts">
                <button class="iconbtn" onclick="openProfile('${o.id}')" title="الملف الكامل"><i class="fa-solid fa-folder-open"></i></button>
                <button class="iconbtn b" onclick="openEdit('${o.id}')" title="تعديل"><i class="fa-solid fa-pen"></i></button>
            </div>
        </td>
    </tr>`).join('');
}

/* ------------------------------ الأكاديمية ------------------------------ */
function renderAcademy() {
    const tb = $('tbAcademy');
    const q = srchC();
    const fRank = $('fRankC').value, sort = $('fSortC').value;

    let list = S.officers.filter(o => o.isCadet && matchQ(o, q));
    if (fRank) list = list.filter(o => o.rank === fRank);

    const cmp = {
        rank: (a, b) => (a.rankLevel - b.rankLevel) || b.daysInService - a.daysInService,
        points: (a, b) => b.points - a.points,
        days: (a, b) => b.daysInService - a.daysInService
    }[sort];
    list = list.slice().sort(cmp);

    if (!S.officers.length) { tb.innerHTML = noDataRow(10); return; }
    if (!list.length) { tb.innerHTML = emptyRow(10, 'fa-graduation-cap', 'ما فيه كاديت', 'ما فيه أحد برتبة كاديت أو سولو كاديت'); return; }

    tb.innerHTML = list.map(o => `
    <tr>
        <td>
            <div class="who">
                ${avatar(o)}
                <div class="nm">
                    <b onclick="openProfile('${o.id}')" title="اضغط لعرض الملف الكامل">${esc(o.name)}</b>
                    <div class="mt">
                        ${o.callsign ? `<span class="tag badge">${esc(o.callsign)}</span>` : ''}
                        <span>${arabicNum(o.daysInService)} يوم</span>
                    </div>
                </div>
            </div>
        </td>
        <td>${topCrown(o)} ${rankSelect(o)}</td>
        <td class="num">${esc(fmtDT(o.joinTs))}</td>
        <td class="num-c"><span class="pill num">${arabicNum((+o.hours || 0).toFixed(1))}<u>س</u></span></td>
        <td class="num-c">${pointsCell(o)}</td>
        <td>${certChips(o.certifications)}</td>
        <td>${dutyChips(o.duties)}</td>
        <td class="num-c">
            <button class="pill num" style="cursor:pointer;border:1px solid var(--line-2)" onclick="openProfile('${o.id}')">
                <i class="fa-solid fa-file-lines" style="font-size:10px"></i>${arabicNum(o.reportsCount)}
            </button>
        </td>
        <td>${statusTag(o.status)}</td>
        <td>
            <div class="rowacts">
                <button class="iconbtn" onclick="openProfile('${o.id}')" title="الملف الكامل"><i class="fa-solid fa-folder-open"></i></button>
                <button class="iconbtn b" onclick="openEdit('${o.id}')" title="تعديل"><i class="fa-solid fa-pen"></i></button>
            </div>
        </td>
    </tr>`).join('');
}

/* ------------------------------ تغيير الرتبة من الجدول ------------------------------ */
document.addEventListener('change', async (e) => {
    const sel = e.target.closest('.ranksel');
    if (!sel) return;

    const id = sel.dataset.officer;
    const newId = sel.value;
    const newName = newId ? (S.ranks.find(r => r.id === newId)?.name || '?') : 'بدون رتبة';
    const o = S.officers.find(x => x.id === id);
    if (!o) return;

    const revert = () => { sel.value = o.rankRoleId || ''; sel.disabled = false; };
    if (newName === o.rank) return revert();

    const reason = prompt(
        `تغيير رتبة ${o.name}\nمن: ${o.rank}\nإلى: ${newName}\n\nاكتب السبب (بيتسجل بالبروفايل). لو تبي بدون سبب اكتب نقطة:`,
        'ترقية');
    if (reason === null) return revert();

    sel.disabled = true;
    try {
        const r = await api(`/api/officers/${id}/rank`, { method: 'POST', body: { rankRoleId: newId || null, reason } });
        toast(`تم بالنت — ${r.from || '—'} ← ${r.to}`, 'ok', 4000);
        const fresh = await api('/api/officers');
        S.officers = fresh.officers || [];
        renderAffairs(); renderAcademy(); renderStats();
        if (S.isAdmin) loadLogs();
    } catch (err) {
        toast(err.message, 'err', 8000);
        revert();
    }
});

/* ------------------------------ المتواجدون ------------------------------ */
function renderOnline() {
    const tb = $('tbOnline');
    const q = srchOn();
    const f = $('fStatOn').value;

    let list = S.presence.filter(p => matchQ({ ...p, name: p.charName || p.username }, q));
    if (f === 'on') list = list.filter(p => p.online);
    if (f === 'off') list = list.filter(p => !p.online);

    if (!S.presence.length) { tb.innerHTML = emptyRow(8, 'fa-users-viewfinder', 'ما فيه أحد دخل بعد', 'أول ما يدخل أحد يظهر هنا مباشرة'); return; }
    if (!list.length) { tb.innerHTML = emptyRow(8, 'fa-magnifying-glass', 'ما فيه نتائج'); return; }

    tb.innerHTML = list.map(p => `
    <tr>
        <td>
            <div class="who">
                ${p.avatar ? `<img class="ava" src="${esc(p.avatar)}" alt="">` : `<div class="ava">${esc(initials(p.charName))}</div>`}
                <div class="nm">
                    <b>${esc(p.charName || p.username)}</b>
                    <div class="mt">
                        <span>${esc(p.username)}</span>
                        ${p.isAdmin ? '<span class="tag rank" style="font-size:10px">مشرف</span>' : ''}
                    </div>
                </div>
            </div>
        </td>
        <td>${esc(p.charName || '—')}</td>
        <td style="font-size:12px">${esc(p.email || '—')}</td>
        <td><span class="copyable mono" onclick="copyIt('${esc(p.copyId || '')}')">${esc(p.copyId || '—')}<i class="fa-solid fa-copy"></i></span></td>
        <td>${p.online
            ? `<span class="tag ok"><i class="fa-solid fa-circle" style="font-size:6px"></i> داخل الآن</span>`
            : '<span class="tag mute">مطّلع</span>'}
            ${p.page ? `<div style="font-size:10.5px;color:var(--tx-3);margin-top:3px">يشوف: ${esc(pageLabel(p.page))}</div>` : ''}
        </td>
        <td>
            <div class="num">${p.online ? ago((Date.now() - p.since) / 1000) : fmtRel(p.lastSeen)}</div>
            ${p.ip ? `<div class="mono" style="font-size:10.5px;color:var(--tx-3)">${esc(p.ip)}</div>` : ''}
        </td>
        <td class="num-c"><span class="pill num">${arabicNum(p.loginCount)}<u>مرة</u></span></td>
        <td>
            <div class="rowacts">
                ${p.copyId ? `<button class="iconbtn" onclick="openOfficerByCopy('${esc(p.copyId)}')" title="ملف الفرد"><i class="fa-solid fa-id-badge"></i></button>` : ''}
                <button class="iconbtn" onclick="openAccount('${esc(p.accountId)}')" title="حسابه"><i class="fa-solid fa-user-gear"></i></button>
            </div>
        </td>
    </tr>`).join('');
}
function pageLabel(p) {
    return ({
        affairs: 'قسم الشؤون', academy: 'الأكاديمية', online: 'المتواجدون',
        accounts: 'حسابات الموقع', logs: 'سجل العمليات'
    })[p] || p;
}

/* ------------------------------ الحسابات ------------------------------ */
function renderAccounts() {
    const tb = $('tbAccounts');
    const q = srchAcc();
    const f = $('fStatAcc').value;
    let list = S.accounts.filter(a => matchQ({ ...a, name: a.charName, rank: '' }, q));
    if (f) list = list.filter(a => a.status === f);

    if (!S.accounts.length) { tb.innerHTML = emptyRow(8, 'fa-user-shield', 'ما فيه تسجيلات بعد', 'أول ما أحد يسجّل بيظهر هنا'); return; }
    if (!list.length) { tb.innerHTML = emptyRow(8, 'fa-magnifying-glass', 'ما فيه نتائج'); return; }

    tb.innerHTML = list.map(a => `
    <tr>
        <td>
            <div class="who">
                ${a.avatar ? `<img class="ava" src="${esc(a.avatar)}" alt="">` : `<div class="ava">${esc(initials(a.charName))}</div>`}
                <div class="nm">
                    <b>${esc(a.charName || a.username)}</b>
                    <div class="mt"><span>${esc(a.username)}</span>${a.isAdmin ? ' <span class="tag rank" style="font-size:10px">مشرف</span>' : ''}</div>
                </div>
            </div>
        </td>
        <td>${esc(a.charName || '—')}</td>
        <td style="font-size:12px">${esc(a.email || '—')}</td>
        <td><span class="copyable mono" onclick="copyIt('${esc(a.copyId)}')">${esc(a.copyId)}<i class="fa-solid fa-copy"></i></span></td>
        <td>${a.verified ? '<span class="tag ok"><i class="fa-solid fa-shield-halved"></i> موثّق</span>' : '<span class="tag mute">غير موثّق</span>'}</td>
        <td>${a.status === 'approved' ? '<span class="tag ok">مفعّل</span>'
            : a.status === 'pending' ? '<span class="tag leave">بانتظار</span>'
                : '<span class="tag bad">موقوف</span>'}</td>
        <td>
            <div class="num">${fmtRel(a.lastLoginAt)}</div>
            <div style="font-size:10.5px;color:var(--tx-3)">${arabicNum(a.loginCount)} دخول</div>
        </td>
        <td>
            <div class="rowacts">
                ${S.isAdmin ? `
                ${a.status !== 'approved' ? `<button class="iconbtn" style="color:var(--ok)" onclick="accAction('${a.id}','approved')" title="موافقة"><i class="fa-solid fa-check"></i></button>` : ''}
                ${a.status !== 'suspended' ? `<button class="iconbtn b" onclick="accAction('${a.id}','suspended')" title="إيقاف"><i class="fa-solid fa-ban"></i></button>` : ''}
                <button class="iconbtn" onclick="accReset('${a.id}')" title="يمسح تسجيله يعيد تسجيله"><i class="fa-solid fa-rotate-left"></i></button>
                <button class="iconbtn" onclick="openAccount('${a.id}')" title="تفاصيل"><i class="fa-solid fa-eye"></i></button>
                ` : `<button class="iconbtn" onclick="openAccount('${a.id}')" title="تفاصيل"><i class="fa-solid fa-eye"></i></button>`}
            </div>
        </td>
    </tr>`).join('');
}

async function accAction(id, status) {
    let reason = null;
    if (status === 'suspended') {
        reason = prompt('ليش توقفه؟ (اكتب السبب — بيظهر له عند ما يحاول يدخل):', 'موقوف من الإدارة');
        if (reason === null) return;
    }
    try {
        await api(`/api/accounts/${id}/status`, { method: 'POST', body: { status, reason } });
        toast(status === 'approved' ? 'تمت الموافقة ✓' : 'تم الإيقاف', 'ok');
    } catch (e) { toast(e.message, 'err'); }
}
async function accReset(id) {
    if (!confirm('يمسح تسجيل هذا المستخدم؟ بيقدر يسجّل من جديد ويكتب إيميله واسم شخصيته.')) return;
    try { await api(`/api/accounts/${id}/reset`, { method: 'POST' }); toast('تم مسح التسجيل — يقدر يسجّل من جديد', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------ إدارة الأدوار ------------------------------ */
const ROLE_TYPES = {
    rank: { label: 'رتبة', icon: 'fa-shield', color: 'var(--gold)' },
    cert: { label: 'شهادة / قسم', icon: 'fa-award', color: 'var(--info)' },
    duty: { label: 'مسؤولية', icon: 'fa-user-tie', color: 'var(--vio)' }
};

async function loadRanks() {
    try {
        const d = await api('/api/roles');
        S.allRoles = d.roles || [];
        S.ranks = S.allRoles.filter(r => r.type === 'rank' && r.enabled !== false);
        S.duties = S.allRoles.filter(r => r.type === 'duty' && r.enabled !== false);
        renderRanks(S.allRoles);
        $('tabRanks').classList.toggle('hide', !S.isAdmin);
        afterRanksLoaded();
    } catch { }
}

function renderRanks(list) {
    const box = $('rankList');
    if (!list.length) {
        box.innerHTML = `<div class="empty"><i class="fa-solid fa-layer-group"></i>
            <b>ما لقيت أدوار</b>
            <span>تأكد إن البوت داخل سيرفر الشرطة وعنده صلاحية View Server، وبعدين Refresh</span></div>`;
        return;
    }
    const q = $('srchRoles').querySelector('input').value || '';

    const groups = { rank: [], cert: [], duty: [] };
    list.forEach(r => { (groups[r.type] ||= []).push(r); });

    const html = ['rank', 'cert', 'duty'].map(type => {
        let items = groups[type] || [];
        if (q) items = items.filter(r => fold(r.name).includes(fold(q)));
        if (!items.length) return '';
        const meta = ROLE_TYPES[type];
        return `
        <div class="sec-t" style="margin-top:22px">
            <i class="fa-solid ${meta.icon}" style="color:${meta.color}"></i>
            ${meta.label}<span>${arabicNum(items.length)}</span>
        </div>
        <div data-group="${type}">${items.map(r => rankRow(r, type)).join('')}</div>`;
    }).join('');

    box.innerHTML = html || '<div class="empty"><i class="fa-solid fa-magnifying-glass"></i><b>ما فيه نتائج</b></div>';
}

function rankRow(r, type) {
    const count = type === 'rank'
        ? S.officers.filter(o => o.rankRoleId === r.id).length
        : (r.members || 0);
    return `
    <div class="certcard" data-rank="${esc(r.id)}" data-type="${type}" style="${r.enabled === false ? 'opacity:.45' : ''}">
        <div class="ic" style="background:${ROLE_TYPES[type].color}22;color:${ROLE_TYPES[type].color};border:1px solid ${ROLE_TYPES[type].color}44">
            <i class="fa-solid ${ROLE_TYPES[type].icon}"></i>
        </div>
        <div style="flex:1;min-width:0">
            <b>${esc(r.name)}</b>
            <div class="m">
                ${count ? `<b>${arabicNum(count)}</b> ${type === 'rank' ? 'فرد' : 'عضو'}` : 'ما فيه أحد'}
                ${r.missing ? ' • <span style="color:var(--bad)">محذوف من الديسكورد</span>' : ''}
                <span class="mono" style="opacity:.55;margin-inline-start:6px">${esc(r.id)}</span>
            </div>
        </div>
        <div class="rowacts" style="justify-content:flex-end">
            <button class="iconbtn" data-mv="-1" title="ارفع"><i class="fa-solid fa-arrow-up"></i></button>
            <button class="iconbtn" data-mv="1" title="أنزل"><i class="fa-solid fa-arrow-down"></i></button>
            <button class="iconbtn" data-rename title="غيّر الاسم"><i class="fa-solid fa-pen"></i></button>
            <button class="iconbtn b" data-toggle title="${r.enabled === false ? 'فعّل' : 'أخفه'}">
                <i class="fa-solid fa-${r.enabled === false ? 'eye-slash' : 'eye'}"></i>
            </button>
        </div>
    </div>`;
}

$('rankList').addEventListener('click', (e) => {
    const card = e.target.closest('[data-rank]');
    if (!card) return;

    if (e.target.closest('[data-mv]')) {
        const dir = +e.target.closest('[data-mv]').dataset.mv;
        const sib = dir < 0 ? card.previousElementSibling : card.nextElementSibling;
        if (!sib || !sib.dataset.rank) return;
        if (dir < 0) card.parentNode.insertBefore(card, sib); else card.parentNode.insertBefore(sib, card);
        card.animate([{ transform: 'scale(.97)' }, { transform: 'scale(1)' }], { duration: 160 });
        return;
    }
    if (e.target.closest('[data-rename]')) {
        const b = card.querySelector('b');
        const nn = prompt('الاسم اللي يبان بالجدول:', b.textContent);
        if (nn === null) return;
        b.textContent = nn.trim().slice(0, 60) || b.textContent;
        return;
    }
    if (e.target.closest('[data-toggle]')) {
        const off = card.style.opacity !== '.45';
        card.style.opacity = off ? '.45' : '1';
        card.querySelector('[data-toggle] i').className = `fa-solid fa-${off ? 'eye-slash' : 'eye'}`;
    }
});

$('btnSaveRanks').addEventListener('click', async () => {
    const roles = [];
    for (const grp of $('rankList').querySelectorAll('[data-group]')) {
        grp.querySelectorAll('[data-rank]').forEach(card => {
            roles.push({
                id: card.dataset.rank,
                type: card.dataset.type,
                name: card.querySelector('b').textContent.trim(),
                enabled: card.style.opacity !== '.45'
            });
        });
    }
    if (!roles.length) return toast('ما فيه أدوار', 'err');
    try {
        await api('/api/roles', { method: 'POST', body: { roles } });
        toast('تم حفظ الأدوار ✓', 'ok');
        await loadRanks();
        if (S.isAdmin) loadLogs();
    } catch (e) { toast(e.message, 'err'); }
});

function afterRanksLoaded() {
    fillRankSelects();
    renderAffairs(); renderAcademy();
}

/* --- إضافة رومات ما انكشفت تلقائياً (فاضية) --- */
$('btnAddRoles').addEventListener('click', async () => {
    const b = $('btnAddRoles');
    b.disabled = true; b.innerHTML = '<span class="load"></span>';
    try {
        const d = await api('/api/roles/undetected');
        if (!d.roles.length) { toast('ما فيه رومات جديدة', 'info'); return; }
        const list = d.roles.map(r =>
            `${arabicNum(r.members)} عضو — ${r.name} (${r.id})`).join('\n');
        const pick = prompt(
            `رومات موجودة بالديسكورد ما ظاهرة بالجدول.\n\nاكتب آيدي الروم اللي تبيها (تقدر تفصلهم بفاصلة، أو انسخ السطر كامل):\n\n${list}`,
            d.roles[0].id);
        if (pick === null) return;
        const ids = pick.split(/[\s,]+/).filter(x => d.roles.some(r => r.id === x));
        if (!ids.length) return toast('ما في آيدي صحيح', 'err');
        const r = await api('/api/roles/add-duty', { method: 'POST', body: { ids } });
        toast(`تمت إضافة ${arabicNum(r.added)} روم`, 'ok');
        await loadRanks();
    } catch (e) { toast(e.message, 'err'); }
    finally { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-plus"></i> أضف روم من الديسكورد'; }
});
/* ------------------------------ السجل ------------------------------ */
function renderLogs() {
    const tb = $('tbLogs');
    if (!S.logs.length) { tb.innerHTML = emptyRow(5, 'fa-scroll', 'السجل فاضي'); return; }
    tb.innerHTML = S.logs.map(l => `
    <tr>
        <td><span class="tag">${esc(l.action)}</span></td>
        <td><b>${esc(l.by)}</b></td>
        <td><span class="mono" style="font-size:11.5px">${esc(String(l.target).slice(0, 26))}</span></td>
        <td style="font-size:12px">${esc(l.details || '—')}</td>
        <td class="num" style="font-size:12px;white-space:nowrap">${esc(fmtDT(l.at))}</td>
    </tr>`).join('');
}

/* ------------------------------ ملف الفرد ------------------------------ */
window.openProfile = async function (id) {
    openOv('ovProfile');
    $('pfBody').innerHTML = '<div class="empty"><span class="load"></span></div>';
    $('pfSub').textContent = 'جارٍ التحميل…';
    $('pfEdit').onclick = null;
    try {
        const d = await api('/api/officers/' + id);
        $('pfSub').textContent = `${d.officer.name} • ${d.officer.rank}`;
        $('pfEdit').onclick = () => { closeOv('ovProfile'); openEdit(id); };
        $('pfBody').innerHTML = renderProfile(d);
    } catch (e) {
        $('pfSub').textContent = '—';
        $('pfBody').innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><b>${esc(e.message)}</b></div>`;
    }
};

function renderProfile(d) {
    const o = d.officer;
    const certs = o.certifications || [];
    const reps = o.reports || [];
    const duties = o.duties || [];

    const dutiesHtml = duties.length ? duties.map(x => `
        <div class="certcard" style="border-color:rgba(167,139,250,.26);background:rgba(167,139,250,.05)">
            <div class="ic" style="background:var(--vio-bg);color:var(--vio)"><i class="fa-solid fa-user-tie"></i></div>
            <div><b>${esc(x.name)}</b></div>
        </div>`).join('')
        : '<div class="empty" style="padding:24px"><i class="fa-solid fa-user-tie"></i><b>ما فيه مسؤوليات</b></div>';

    const certsHtml = certs.length ? certs.map(c => `
        <div class="certcard">
            <div class="ic" style="background:${esc(c.color || '#d9b45b')}22;color:${esc(c.color || '#d9b45b')};border:1px solid ${esc(c.color || '#d9b45b')}44">
                <i class="fa-solid ${esc(c.icon || 'fa-award')}"></i>
            </div>
            <div>
                <b>${esc(c.ar)}</b>
                <div class="m">
                    ${c.grantedAt
            ? `أعطاه <b>${esc(c.grantedByName || 'غير معروف')}</b> • ${esc(fmtDT(c.grantedAt))}`
            : 'ما يظهر في سجل الديسكورد'}
                </div>
            </div>
        </div>`).join('')
        : '<div class="empty" style="padding:24px"><i class="fa-solid fa-award"></i><b>ما فيه أقسام</b></div>';

    const plog = d.pointsLog || [];
    const plogHtml = plog.length ? plog.map(p => {
        const isStrike = p.type === 'strike' || p.delta < 0;
        return `
        <div class="certcard" style="${isStrike ? 'border-color:rgba(248,113,113,.28);background:rgba(248,113,113,.06)' : 'border-color:rgba(52,211,153,.24);background:rgba(52,211,153,.05)'}">
            <div class="ic" style="background:${isStrike ? 'var(--bad-bg)' : 'var(--ok-bg)'};color:${isStrike ? 'var(--bad)' : 'var(--ok)'}">
                <i class="fa-solid ${isStrike ? 'fa-gavel' : 'fa-star'}"></i>
            </div>
            <div style="flex:1;min-width:0">
                <b style="color:${isStrike ? 'var(--bad)' : 'var(--ok)'}">
                    ${p.delta >= 0 ? '+' : ''}${arabicNum(p.delta)} نقطة
                    ${p.delta !== p.requested ? `<span style="color:var(--tx-3);font-size:11px">(طلبوا ${arabicNum(p.requested)})</span>` : ''}
                </b>
                <div class="m">
                    ${p.reason ? esc(p.reason) : 'بدون سبب محدد'}
                    ${p.by ? ` • <b>${esc(p.by)}</b>` : ''}
                    • الرصيد بعدها: <b>${arabicNum(p.balanceAfter)}</b>
                </div>
            </div>
            <div style="font-size:10.5px;color:var(--tx-3);white-space:nowrap">${esc(fmtDT(p.at))}</div>
        </div>`;
    }).join('')
        : '<div class="empty" style="padding:24px"><i class="fa-solid fa-star"></i><b>ما فيه حركات نقاط</b><span>اكتب رسالة بروم النقاط أو الخصم عشان تنسجل هنا</span></div>';

    const proms = d.promotions || [];
    const promsHtml = proms.length ? proms.map(p => `
        <div class="certcard" style="border-color:rgba(217,180,91,.26);background:rgba(217,180,91,.05)">
            <div class="ic" style="background:var(--gold-glow);color:var(--gold)">
                <i class="fa-solid fa-arrow-trend-up"></i>
            </div>
            <div style="flex:1;min-width:0">
                <b>${esc(p.from || '—')} <i class="fa-solid fa-arrow-left" style="font-size:10px;color:var(--gold);margin:0 5px"></i> ${esc(p.to || '—')}</b>
                <div class="m">
                    ${p.reason ? esc(p.reason) : 'بدون سبب'}
                    ${p.by ? ` • <b>${esc(p.by)}</b>` : ''}
                </div>
            </div>
            <div style="font-size:10.5px;color:var(--tx-3);white-space:nowrap">${esc(fmtDT(p.at))}</div>
        </div>`).join('')
        : '<div class="empty" style="padding:24px"><i class="fa-solid fa-arrow-trend-up"></i><b>ما فيه ترقيات مسجلة</b><span>اكتب رسالة بروم الترقيات عشان تنسجل هنا</span></div>';

    const repsHtml = reps.length ? reps.slice(0, 25).map(r => `
        <div class="rep">
            <div class="h">
                <span class="tag cadet"><i class="fa-solid fa-file-lines"></i> ${esc(r.channelName || 'MDT')}</span>
                <b>${esc(r.authorName || '—')}</b>
                <time>${esc(fmtDT(r.at))}</time>
            </div>
            <div class="bd clamp">${esc(r.body || '')}</div>
            <button class="more" onclick="this.previousElementSibling.classList.toggle('clamp');this.textContent=this.textContent==='اقرأ كامل'?'إخفاء':'اقرأ كامل'">اقرأ كامل</button>
        </div>`).join('')
        : '<div class="empty" style="padding:24px"><i class="fa-solid fa-folder-open"></i><b>ما فيه تقارير</b></div>';

    const tl = d.timeline.length ? d.timeline.map(t => `
        <div class="tl-i t-${esc(t.type)}">
            <b><i class="fa-solid ${esc(t.icon || 'fa-circle')}" style="font-size:11px;color:var(--gold);margin-inline-end:5px"></i>${esc(t.title)}</b>
            ${t.detail ? `<div class="d">${esc(t.detail)}</div>` : ''}
            <div class="w">
                <span><i class="fa-regular fa-clock"></i> ${esc(fmtDT(t.at))}</span>
                ${t.byName ? `<span><i class="fa-solid fa-user-pen"></i> ${esc(t.byName)}</span>` : ''}
            </div>
        </div>`).join('')
        : '<div class="empty" style="padding:24px"><i class="fa-solid fa-timeline"></i><b>ما فيه أحداث مسجّلة</b></div>';

    const acc = d.account;

    return `
    <div class="fh">
        ${o.avatar ? `<img src="${esc(o.avatar)}" alt="">` : `<div class="ava">${esc(initials(o.charName || o.name))}</div>`}
        <div class="info">
            <h2>${esc(o.name)}</h2>
            <div class="chips">
                ${o.callsign ? `<span class="tag badge"><i class="fa-solid fa-id-badge"></i> ${esc(o.callsign)}</span>` : ''}
                ${rankTag(o)}
                ${topCrown(o)}
                ${statusTag(o.status)}
                ${o.isLSPD ? '<span class="tag ck"><i class="fa-solid fa-shield-halved"></i> LSPD</span>' : ''}
            </div>
        </div>
    </div>

    <div class="fgrid">
        <div class="fcard gold"><u>الساعات</u><b class="num">${arabicNum((+o.hours || 0).toFixed(1))} <small>ساعة</small></b></div>
        <div class="fcard gold"><u>النقاط</u><b class="num">${arabicNum(o.points)}</b></div>
        <div class="fcard ${d.strikeCount ? '' : 'gold'}" style="${d.strikeCount ? 'border-color:rgba(248,113,113,.3);background:rgba(248,113,113,.07)' : ''}">
            <u>الاسترايك</u><b class="num" style="${d.strikeCount ? 'color:var(--bad)' : ''}">${arabicNum(d.strikeCount || 0)}</b>
        </div>
        <div class="fcard"><u>التقارير</u><b class="num">${arabicNum(o.reportsCount)}</b></div>
        <div class="fcard"><u>الأقسام</u><b class="num">${arabicNum(o.certCount)}</b></div>
        <div class="fcard"><u>مدة الخدمة</u><b class="num">${arabicNum(o.daysInService)} <small>يوم</small></b></div>
    </div>

    <div class="sec-t"><i class="fa-solid fa-circle-info"></i> البيانات الأساسية <span>اضغط على الآيدي للنسخ</span></div>
    <div class="kv">
        <u>الرتبة</u><b>${esc(o.rank)}</b>
        ${o.rankGrantedBy ? `<u>أعطاه الرتبة</u><b>${esc(o.rankGrantedBy)} • ${esc(fmtDT(o.rankGrantedAt))}</b>` : ''}
        ${d.lastStrikeAt ? `<u>آخر استرايك</u><b style="color:var(--bad)">${esc(fmtDT(d.lastStrikeAt))}</b>` : ''}
        <u>كوبى آى دى</u><b><span class="copyable mono" onclick="copyIt('${esc(o.id)}')">${esc(o.id)}<i class="fa-solid fa-copy"></i></span></b>
        <u>يونيت</u><b>${esc(o.username)}${o.tag && o.tag !== o.username ? ` <span style="color:var(--tx-3)">(${esc(o.tag)})</span>` : ''}</b>
        <u>اسم الشخصية</u><b>${esc(o.charName || '—')}</b>
        ${o.oocName ? `<u>الاسم الحقيقي</u><b>${esc(o.oocName)}</b>` : ''}
        <u>تاريخ التعيين</u><b>${esc(fmtDT(o.joinTs))} <span style="color:var(--tx-3)">(${arabicNum(o.daysInService)} يوم)</span></b>
        <u>حساب ديسكورد</u><b>${esc(fmtDT(Date.parse(o.accountCreated)))}</b>
        <u>إجازة</u><b>${o.onLeave ? `نعم${o.leaveUntil ? ` — حتى ${esc(fmtDT(Date.parse(o.leaveUntil)))}` : ''}` : 'لا'}</b>
        ${o.notes ? `<u>ملاحظات</u><b>${esc(o.notes)}</b>` : ''}
        ${acc ? `<u>حسابه بالموقع</u><b>${esc(acc.charName)} — ${esc(acc.email)}</b>` : ''}
    </div>

    <div class="sec-t"><i class="fa-solid fa-star"></i> سجل النقاط <span>${arabicNum(plog.length)} حركة</span></div>
    ${plogHtml}

    <div class="sec-t"><i class="fa-solid fa-arrow-trend-up"></i> الترقيات <span>${arabicNum(proms.length)}</span></div>
    ${promsHtml}

    <div class="sec-t"><i class="fa-solid fa-award"></i> الأقسام والشهادات <span>${arabicNum(certs.length)}</span></div>
    ${certsHtml}

    <div class="sec-t"><i class="fa-solid fa-user-tie"></i> المسؤوليات
        <span>${arabicNum(duties.length)}${S.isAdmin ? ' • <button class="btn btn-ghost btn-sm" onclick="openDuties(\'' + esc(o.id) + '\')"><i class="fa-solid fa-pen"></i> تعديل</button>' : ''}</span>
    </div>
    ${dutiesHtml}

    <div class="sec-t"><i class="fa-solid fa-timeline"></i> سجل الخدمة <span>${arabicNum(d.timeline.length)} حدث</span></div>
    <div class="tl">${tl}</div>

    <div class="sec-t"><i class="fa-solid fa-file-lines"></i> التقارير <span>${arabicNum(reps.length)}</span></div>
    ${repsHtml}
    `;
}

window.openOfficerByCopy = function (copyId) {
    const o = S.officers.find(x => x.id === copyId);
    if (o) { closeAllOv(); openProfile(o.id); }
    else toast('ما لقيناه بجدول الأفراد — يمكن ما عنده رتبة شرطة', 'info');
};

/* ------------------------------ تعديل ------------------------------ */
window.openEdit = function (id) {
    const o = S.officers.find(x => x.id === id);
    if (!o) return;
    $('edId').value = id;
    $('edSub').textContent = `${o.name} — ${o.rank}`;
    $('edPoints').value = o.points;
    $('edPointsView').textContent = arabicNum(o.points);
    $('edAddPoints').value = '';
    $('edHours').value = o.hoursManual ? o.hours : '';
    $('edHoursView').textContent = arabicNum((+o.hours || 0).toFixed(1));
    $('edAutoHint').innerHTML = o.hoursAuto
        ? `الساعات التلقائية من بوت الديسكورد: <b style="color:var(--gold)">${arabicNum(o.hoursAuto)}</b> ساعة`
        : 'ما فيه ساعات تلقائية مسجّلة';
    $('edLeave').checked = !!o.onLeave;
    $('edDisabled').checked = !!o.disabled;
    $('edLeaveUntil').value = o.leaveUntil ? String(o.leaveUntil).slice(0, 10) : '';
    $('edNotes').value = o.notes || '';
    $('edMsg').innerHTML = '';
    $('edRecalc').style.display = S.isAdmin ? '' : 'none';

    // قائمة الرتب من رومات الديسكورد
    const rsel = $('edRankRole');
    rsel.innerHTML = '<option value="">— بدون تغيير —</option>' +
        S.ranks.map(r => `<option value="${esc(r.id)}"${r.id === o.rankRoleId ? ' selected' : ''}>${esc(r.name)}</option>`).join('') +
        '<option value="__none">— إزالة الرتبة —</option>';
    rsel.disabled = !S.isAdmin;
    $('edRankHint').textContent = S.isAdmin
        ? 'تغيير الرتبة من هنا يشيل رتبته القديمة ويضيف الجديدة فعلياً بالديسكورد.'
        : 'تغيير الرتب متاح للمشرف فقط.';

    openOv('ovEdit');
};
$('edPoints').addEventListener('input', () => $('edPointsView').textContent = arabicNum($('edPoints').value || 0));
$('edHours').addEventListener('input', () => $('edHoursView').textContent = arabicNum($('edHours').value || 0));

$('edRecalc').addEventListener('click', async () => {
    const id = $('edId').value;
    if (!confirm('يعيد حساب النقاط من السجل ويلصّح التكرار. يكمل؟')) return;
    const b = $('edRecalc');
    b.disabled = true; b.innerHTML = '<span class="load"></span>';
    try {
        const r = await api(`/api/officers/${id}/recalc`, { method: 'POST' });
        toast(`تم — الرصيد ${arabicNum(r.points)} (شال ${arabicNum(r.removed)} حركة مكررة)`, 'ok', 5000);
        closeOv('ovEdit');
        const fresh = await api('/api/officers');
        S.officers = fresh.officers || [];
        renderAll();
        if (S.isAdmin) loadLogs();
    } catch (e) { toast(e.message, 'err'); }
    finally { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-rotate"></i> إعادة حساب النقاط من السجل'; }
});

$('edSave').addEventListener('click', async () => {
    const id = $('edId').value;
    const rankVal = $('edRankRole').value;
    const payload = {
        points: $('edPoints').value === '' ? undefined : +$('edPoints').value,
        addPoints: $('edAddPoints').value === '' ? undefined : +$('edAddPoints').value,
        hours: $('edHours').value === '' ? null : +$('edHours').value,
        onLeave: $('edLeave').checked,
        leaveUntil: $('edLeaveUntil').value || null,
        disabled: $('edDisabled').checked,
        notes: $('edNotes').value
    };
    const btn = $('edSave');
    btn.disabled = true; btn.innerHTML = '<span class="load"></span>';
    try {
        await api('/api/officers/' + id, { method: 'POST', body: payload });

        // تغيير الرتبة — عملية منفصلة لأنها تمس الديسكورد
        if (rankVal) {
            const isRemove = rankVal === '__none';
            const reason = prompt(isRemove
                ? 'اكتب سبب إزالة الرتبة (بيتسجل بالبروفايل):'
                : 'اكتب سبب تغيير الرتبة (بيتسجل بالبروفايل):', 'ترقية');
            if (reason !== null) {
                const r = await api(`/api/officers/${id}/rank`, {
                    method: 'POST',
                    body: { rankRoleId: isRemove ? null : rankVal, reason }
                });
                toast(`الرتبة: ${r.from || '—'} ← ${r.to}`, 'ok', 4000);
            }
        }

        toast('تم الحفظ ✓', 'ok');
        closeOv('ovEdit');
        const fresh = await api('/api/officers');
        S.officers = fresh.officers || [];
        fillRankFilters(); renderAll();
        if (S.isAdmin) loadLogs();
    } catch (e) {
        showMsg($('edMsg'), e.message, 'err');
    } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ';
    }
});

/* ------------------------------ تحرير المسؤوليات ------------------------------ */
let dutyState = { officerId: null, add: [], remove: [] };

window.openDuties = function (id) {
    const o = S.officers.find(x => x.id === id);
    if (!o) return;
    if (!S.duties.length) return toast('ما فيه مسؤوليات مكتشفة — شوف تبويب "الأدوار والمسؤوليات"', 'info', 4500);
    dutyState = { officerId: id, add: [], remove: [] };
    $('duSub').textContent = `${o.name} — ${o.rank}`;
    $('duMsg').innerHTML = '';
    drawDuties();
    openOv('ovDuties');
};

function drawDuties() {
    const o = S.officers.find(x => x.id === dutyState.officerId);
    if (!o) return;
    const has = new Set((o.duties || []).map(d => d.roleId));
    const willHave = new Set([...has].filter(r => !dutyState.remove.includes(r)));
    dutyState.add.forEach(r => willHave.add(r));

    $('duList').innerHTML = S.duties.map(d => {
        const on = willHave.has(d.id);
        const pending = dutyState.add.includes(d.id)
            ? '<span class="tag ok" style="font-size:10px">تُضاف</span>'
            : (dutyState.remove.includes(d.id) ? '<span class="tag bad" style="font-size:10px">تُشال</span>' : '');
        return `
        <label class="sw" style="display:flex;align-items:center;gap:11px;padding:11px 13px;background:rgba(4,8,15,.4);border:1px solid var(--line-2);border-radius:var(--r);margin-bottom:8px;cursor:pointer">
            <input type="checkbox" data-duty="${esc(d.id)}" ${on ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--vio)">
            <span style="font-size:13.5px;font-weight:700;color:var(--tx)">${esc(d.name)}</span>
            ${pending}
        </label>`;
    }).join('');
}

$('duList').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-duty]');
    if (!cb) return;
    const id = cb.dataset.duty;
    dutyState.add = dutyState.add.filter(x => x !== id);
    dutyState.remove = dutyState.remove.filter(x => x !== id);
    if (cb.checked) dutyState.add.push(id);
    else dutyState.remove.push(id);
    drawDuties();
});

$('duSave').addEventListener('click', async () => {
    if (!dutyState.add.length && !dutyState.remove.length) { closeOv('ovDuties'); return; }
    const reason = prompt('اكتب سبب التعديل (بيتسجل ببروفايل الفرد):', 'تعيين مسؤوليات') ?? 'تعيين مسؤوليات';
    const btn = $('duSave');
    btn.disabled = true; btn.innerHTML = '<span class="load"></span>';
    try {
        await api(`/api/officers/${dutyState.officerId}/roles`, {
            method: 'POST',
            body: { add: dutyState.add, remove: dutyState.remove, reason }
        });
        toast(`تم — أُضيفت ${dutyState.add.length} وشُالت ${dutyState.remove.length}`, 'ok');
        closeOv('ovDuties');
        closeOv('ovProfile');
        const fresh = await api('/api/officers');
        S.officers = fresh.officers || [];
        renderAll();
    } catch (e) {
        showMsg($('duMsg'), e.message, 'err');
    } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ';
    }
});

/* ------------------------------ حساب ------------------------------ */
window.openAccount = async function (id) {
    const a = S.accounts.find(x => x.id === id);
    if (!a) return;
    $('acSub').textContent = a.charName || a.username;
    $('acBody').innerHTML = `
    <div class="fh">
        ${a.avatar ? `<img src="${esc(a.avatar)}" alt="">` : `<div class="ava">${esc(initials(a.charName))}</div>`}
        <div class="info">
            <h2>${esc(a.charName || a.username)}</h2>
            <div class="chips">
                ${a.status === 'approved' ? '<span class="tag ok">مفعّل</span>' : a.status === 'pending' ? '<span class="tag leave">بانتظار</span>' : '<span class="tag bad">موقوف</span>'}
                ${a.verified ? '<span class="tag ck">موثّق</span>' : '<span class="tag mute">غير موثّق</span>'}
                ${a.isAdmin ? '<span class="tag rank">مشرف</span>' : ''}
                ${a.canEdit === false ? '<span class="tag mute">بدون تعديل</span>' : ''}
            </div>
        </div>
    </div>
    <div class="kv">
        <u>الاسم بالديسكورد</u><b>${esc(a.username)}</b>
        <u>اسم الشخصية</u><b>${esc(a.charName || '—')}</b>
        <u>الإيميل</u><b>${esc(a.email || '—')}</b>
        <u>كوبى آى دى</u><b><span class="copyable mono" onclick="copyIt('${esc(a.copyId)}')">${esc(a.copyId)}<i class="fa-solid fa-copy"></i></span></b>
        <u>نتيجة التحقق</u><b>${esc(a.verifyNote || '—')}</b>
        <u>أول تسجيل</u><b>${esc(fmtDT(a.firstLoginAt))}</b>
        <u>آخر دخول</u><b>${esc(fmtDT(a.lastLoginAt))} <span style="color:var(--tx-3)">(${esc(fmtRel(a.lastLoginAt))})</span></b>
        <u>عدد الدخول</u><b>${arabicNum(a.loginCount)} مرة</b>
        <u>آخر IP</u><b class="mono">${esc(a.lastIp || '—')}</b>
        <u>الجهاز</u><b>${esc(a.lastDevice || '—')}</b>
        <u>مرات إعادة التسجيل</u><b>${arabicNum(a.resetCount)}</b>
        ${a.blockReason ? `<u>سبب الإيقاف</u><b style="color:var(--bad)">${esc(a.blockReason)}</b>` : ''}
    </div>`;
    $('acFoot').innerHTML = S.isAdmin ? `
        <button class="btn btn-ghost" data-close>إغلاق</button>
        <button class="btn btn-warn" onclick="accAction('${a.id}','pending')"><i class="fa-solid fa-hourglass-half"></i> رجّع للانتظار</button>
        <button class="btn btn-bad" onclick="accDel('${a.id}')"><i class="fa-solid fa-trash"></i> حذف</button>
        <button class="btn btn-ok" onclick="accAction('${a.id}','approved')"><i class="fa-solid fa-check"></i> تفعيل</button>` : '<button class="btn btn-ghost" data-close>إغلاق</button>';
    openOv('ovAccount');
    qa('#acFoot [data-close]').forEach(b => b.onclick = () => closeOv('ovAccount'));
};
async function accDel(id) {
    if (!confirm('تحذف هذا الحساب نهائياً؟')) return;
    try { await api('/api/accounts/' + id, { method: 'DELETE' }); closeOv('ovAccount'); toast('تم الحذف', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
}
window.accAction = accAction;
window.accReset = accReset;

/* ------------------------------ نسخ ------------------------------ */
window.copyIt = function (text) {
    if (!text) return;
    const done = () => toast('تم النسخ ✓', 'ok', 1500);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    else fallback();
    function fallback() {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch { toast('ما قدرت أنسخ', 'err'); }
        ta.remove();
    }
};

/* ------------------------------ تحديث ------------------------------ */
$('btnRefresh').addEventListener('click', async () => {
    const b = $('btnRefresh');
    b.querySelector('i').classList.add('fa-spin');
    try {
        await api('/api/refresh', { method: 'POST' });
        await loadAll();
        toast('تم التحديث من الديسكورد ✓', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { setTimeout(() => b.querySelector('i').classList.remove('fa-spin'), 400); }
});

/* ------------------------------ الإقلاع ------------------------------ */
(async function boot() {
    setLive(false);
    checkBotHealth();
    if (S.token) {
        try {
            const r = await api('/api/auth/me');
            S.account = r.account; S.isAdmin = !!r.account.isAdmin;
            afterAuth({ token: S.token, account: r.account });
        } catch { hardLogout(); }
    }
    // فاحص دوري: لو البوت اتصل متأخر، يختفي التنبيه لوحده
    setInterval(() => {
        const box = $('botWarn');
        if (box && !box.classList.contains('hide')) checkBotHealth();
    }, 15000);
})();
