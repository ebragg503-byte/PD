const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.json());

// قاعدة بيانات تقريبية في الذاكرة (In-Memory Database)
let cadetsData = [
  { discordId: "101", name: "الكاديت أحمد", hours: 22, mdtReports: 12, status: "نشط" },
  { discordId: "102", name: "الكاديت خالد", hours: 8, mdtReports: 3, status: "نشط" },
  { discordId: "103", name: "الكاديت محمد", hours: 35, mdtReports: 25, status: "نشط" }
];

// 1. API لاستقبال بيانات الساعات وتسجيلها للموقع
app.post('/api/clock-in', (req, res) => {
  const { discordId, name, hoursAdded } = req.body;
  let cadet = cadetsData.find(c => c.discordId === discordId);
  
  if (!cadet) {
    cadet = { discordId, name, hours: 0, mdtReports: 0, status: "نشط" };
    cadetsData.push(cadet);
  }
  
  cadet.hours += Number(hoursAdded);
  res.json({ message: "تم تسجيل الساعات بنجاح في الموقع", cadet });
});

// 2. API لاستقبال تقارير الـ MDT وتسجيلها للموقع
app.post('/api/mdt-report', (req, res) => {
  const { discordId, name } = req.body;
  let cadet = cadetsData.find(c => c.discordId === discordId);
  
  if (!cadet) {
    cadet = { discordId, name, hours: 0, mdtReports: 0, status: "نشط" };
    cadetsData.push(cadet);
  }
  
  cadet.mdtReports += 1;
  res.json({ message: "تم تسجيل تقرير MDT بنجاح", cadet });
});

// 3. API لجلب كافة البيانات للموقع
app.get('/api/cadets', (req, res) => {
  res.json(cadetsData);
});

// 4. واجهة الموقع (Dashboard)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <title>لوحة التحكم - أكاديمية الشرطة</title>

      <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 30px; }
        h1 { color: #38bdf8; text-align: center; }
        .container { max-width: 1000px; margin: 0 auto; background: #1e293b; padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        .controls { display: flex; gap: 10px; margin-bottom: 20px; }
        button { background: #0284c7; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; }
        button:hover { background: #0369a1; }
        button.danger { background: #e11d48; }
        button.success { background: #16a34a; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 12px; text-align: right; border-bottom: 1px solid #334155; }
        th { background: #0f172a; color: #94a3b8; }
        .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        .badge-promote { background: #15803d; color: #dcfce7; }
        .badge-fire { background: #991b1b; color: #fee2e2; }
        .badge-active { background: #1e40af; color: #dbeafe; }
      </style>

    </head>
    <body>
      <div class="container">
        <h1>لوحة تحكم الأكاديمية (MDT والساعات)</h1>
        
        <div class="controls">
          <button onclick="loadCadets('all')">عرض الكل</button>
          <button class="success" onclick="loadCadets('promote')">جرد الترقيات (20+ ساعة & 10+ تقارير)</button>
          <button class="danger" onclick="loadCadets('fire')">جرد الفصل (أقل من 10 ساعات)</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>ID الديسكورد</th>
              <th>اسم الكاديت</th>
              <th>إجمالي الساعات</th>
              <th>تقارير MDT</th>
              <th>الحالة التلقائية</th>
            </tr>
          </thead>
          <tbody id="cadetTable">
            <!-- سيتم تحميل البيانات هنا -->
          </tbody>
        </table>
      </div>

      <script>
        async function loadCadets(filter = 'all') {
          const res = await fetch('/api/cadets');
          const data = await res.json();
          const table = document.getElementById('cadetTable');
          table.innerHTML = '';

          data.forEach(cadet => {
            let statusBadge = '<span class="badge badge-active">نشط</span>';
            
            // شروط الجرد والترقية
            const isEligibleForPromotion = cadet.hours >= 20 && cadet.mdtReports >= 10;
            const isEligibleForDismissal = cadet.hours < 10;

            if (filter === 'promote' && !isEligibleForPromotion) return;
            if (filter === 'fire' && !isEligibleForDismissal) return;

            if (isEligibleForPromotion) {
              statusBadge = '<span class="badge badge-promote">مستحق ترقية</span>';
            } else if (isEligibleForDismissal) {
              statusBadge = '<span class="badge badge-fire">مهدد بالفصل</span>';
            }

            table.innerHTML += \`
              <tr>
                <td>\${cadet.discordId}</td>
                <td>\${cadet.name}</td>
                <td>\${cadet.hours} ساعة</td>
                <td>\${cadet.mdtReports} تقرير</td>
                <td>\${statusBadge}</td>
              </tr>
            \`;
          });
        }

        // تحميل البيانات أول ما تفتح الصفحة
        loadCadets();
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`الموقع شغال الآن على الرابط: http://localhost:${PORT}`);
});