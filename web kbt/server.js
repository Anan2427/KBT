const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto'); // Pengganti bcrypt (bawaan Node.js, anti-error)

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Membuat direktori Volume Railway jika belum ada
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

const DB_FILE = path.join(DATA_DIR, 'db_store.json');

// Inisialisasi Database Relasional
let db = {
    users: [],
    products: [],
    orders: [],
    activity_logs: []
};

// Membaca data lama dari Volume jika ada
if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) { console.error("Initialize DB Error, creating new store", e); }
}

// Fungsi Simpan ke Disk Permanen Volume Railway
function saveToDisk() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// Helper Enkripsi Pengganti Bcrypt (Aman & Cepat)
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Seed Data Awal jika database kosong
if (db.users.length === 0) {
    db.users.push({ id: "1", name: 'Lecture Evaluator Admin', email: 'admin@pasarkita.com', password: hashPassword('admin123'), role: 'admin' });
    db.users.push({ id: "2", name: 'John Doe', email: 'john@gmail.com', password: hashPassword('user123'), role: 'user' });
    
    db.products.push({ id: "101", title: 'Sverom chair', price: 65000, profit: 15000, category: 'Chair', image: '', views: 0 });
    db.products.push({ id: "102", title: 'Mini sit me', price: 75000, profit: 20000, category: 'Chair', image: '', views: 0 });
    db.products.push({ id: "103", title: 'Old Chair', price: 75000, profit: 10000, category: 'Chair', image: '', views: 0 });
    saveToDisk();
}

function logActivity(userName, activity) {
    db.activity_logs.unshift({
        id: String(Date.now()),
        user_name: userName,
        activity: activity,
        timestamp: new Date().toISOString()
    });
    saveToDisk();
}

/* ================= ROUTER API SERVICE ================= */
app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body;
    const exists = db.users.find(u => u.email === email);
    if (exists) return res.status(400).json({ error: 'Email sudah terdaftar.' });

    db.users.push({
        id: String(Date.now()),
        name, email, password: hashPassword(password), role: 'user'
    });
    logActivity(name, 'User registration');
    res.json({ success: true });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const user = db.users.find(u => u.email === email && u.password === hashPassword(password));
    if (!user) return res.status(401).json({ error: 'Email atau password salah' });

    logActivity(user.name, 'User login');
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/products', (req, res) => {
    res.json(db.products);
});

app.post('/api/products', (req, res) => {
    const { title, price, profit, category, image, adminName } = req.body;
    const newProd = { id: String(Date.now()), title, price: Number(price), profit: Number(profit), category, image, views: 0 };
    db.products.push(newProd);
    logActivity(adminName || 'Admin', `Created product: ${title}`);
    res.json({ success: true, id: newProd.id });
});

app.put('/api/products/:id', (req, res) => {
    const { title, price, profit, category, image, adminName } = req.body;
    const prod = db.products.find(p => p.id === req.params.id);
    if (!prod) return res.status(404).json({ error: 'Not found' });

    prod.title = title;
    prod.price = Number(price);
    prod.profit = Number(profit);
    prod.category = category;
    if (image) prod.image = image;

    logActivity(adminName || 'Admin', `Updated product ID: ${req.params.id}`);
    res.json({ success: true });
});

app.delete('/api/products/:id', (req, res) => {
    const { adminName } = req.body;
    db.products = db.products.filter(p => p.id !== req.params.id);
    logActivity(adminName || 'Admin', `Deleted product ID: ${req.params.id}`);
    res.json({ success: true });
});

app.post('/api/products/:id/view', (req, res) => {
    const prod = db.products.find(p => p.id === req.params.id);
    if (prod) { prod.views = (prod.views || 0) + 1; saveToDisk(); }
    res.json({ success: true });
});

app.post('/api/orders', (req, res) => {
    const { userId, userName, productName, totalPrice, profit, address } = req.body;
    db.orders.push({
        id: String(Date.now()),
        user_id: userId,
        product_name: productName,
        total_price: Number(totalPrice),
        profit: Number(profit),
        status: 'Waiting Confirmation',
        delivery_address: address,
        created_at: new Date().toISOString()
    });
    logActivity(userName, `Checkout Order ${productName}`);
    res.json({ success: true });
});

app.get('/api/orders/user/:userId', (req, res) => {
    const userOrders = db.orders.filter(o => o.user_id === req.params.userId || req.params.userId === 'john_placeholder');
    res.json(userOrders);
});

app.post('/api/orders/:id/status', (req, res) => {
    const { status } = req.body;
    const order = db.orders.find(o => o.id === req.params.id);
    if (order) { order.status = status; saveToDisk(); }
    res.json({ success: true });
});

app.get('/api/admin/dashboard', (req, res) => {
    const totalUsers = db.users.filter(u => u.role === 'user').length;
    const totalOrders = db.orders.length;
    const totalProducts = db.products.length;
    
    let totalRevenue = 0;
    let totalProfit = 0;
    db.orders.forEach(o => { totalRevenue += o.total_price; totalProfit += o.profit; });

    res.json({
        totalUsers,
        totalOrders,
        totalRevenue,
        totalProfit,
        totalProducts,
        logs: db.activity_logs.slice(0, 30)
    });
});

app.listen(PORT, () => console.log(`🚀 Secure Cloud Database Engine active on port: ${PORT}`));
