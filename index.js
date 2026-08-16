// 1. التحقق التلقائي عند فتح أو تحديث الصفحة (Auto Check)
document.addEventListener('DOMContentLoaded', async () => {
    const savedCopyId = localStorage.getItem('user_copy_id');
    const savedUsername = localStorage.getItem('user_name');

    if (savedCopyId) {
        try {
            const res = await fetch('/api/login-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    copyId: savedCopyId, 
                    username: savedUsername 
                })
            });
            
            const data = await res.json();

            if (data.success && data.approved) {
                // إذا وافق المسؤول سابقاً: دخول مباشر للوحة
                showDashboard(data.user);
            } else {
                // إذا لم يوافق بعد: إظهار شاشة الانتظار مع حفظ البيانات
                showPendingState();
            }
        } catch (e) {
            console.error("خطأ في التحقق التلقائي:", e);
        }
    }
});

// 2. عند الضغط على زر "طلب الدخول"
async function submitLogin() {
    const usernameInput = document.getElementById('usernameInput').value.trim();
    const copyIdInput = document.getElementById('copyIdInput').value.trim();
    const secretCodeInput = document.getElementById('secretCodeInput')?.value.trim();

    if (!usernameInput || !copyIdInput) {
        alert('يرجى كتابة الاسم والـ Discord Copy ID');
        return;
    }

    // حفظ البيانات محلية فوراً لعدم ضياعها بعد الريفرش
    localStorage.setItem('user_copy_id', copyIdInput);
    localStorage.setItem('user_name', usernameInput);

    try {
        const res = await fetch('/api/login-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username: usernameInput, 
                copyId: copyIdInput, 
                secretCode: secretCodeInput 
            })
        });

        const data = await res.json();

        if (data.approved) {
            showDashboard(data.user);
        } else {
            showPendingState();
        }
    } catch (e) {
        console.error("خطأ في إرسال الطلب:", e);
    }
}

// 3. التحديث المباشر عند قبول المسؤول بدون الحاجة لإعادة التحميل
socket.on('usersUpdate', (users) => {
    const myCopyId = localStorage.getItem('user_copy_id');
    if (!myCopyId) return;

    const myAccount = users.find(u => String(u.copyId).trim() === String(myCopyId).trim());
    if (myAccount && myAccount.approved) {
        showDashboard(myAccount);
    }
});

// دالة إظهار حالة الانتظار
function showPendingState() {
    const statusMsg = document.getElementById('statusMessage');
    if (statusMsg) {
        statusMsg.innerText = 'تم إرسال الطلب، بانتظار موافقة المسؤول...';
        statusMsg.style.display = 'block';
    }
}
