const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Menggunakan File Database SQL Lokal agar data CRUD permanen dan tidak hilang
// Mengarahkan ke folder /app/data milik Volume Railway agar tersimpan permanen di cloud
const fs = require('fs');
const dbDir = './data';
if (!fs.existsSync(dbDir)){
    fs.mkdirSync(dbDir);
}

const db = new sqlite3.Database('./data/pasarkita.db', (err) => {
    if (err) console.error('Database connection failed:', err);
    else console.log('Connected to SQL Database in Persistent Cloud Volume successfully.');
});

// Inisialisasi Tabel SQL
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        price REAL,
        profit REAL,
        category TEXT,
        image TEXT, 
        views INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        product_name TEXT,
        total_price REAL,
        profit REAL,
        status TEXT DEFAULT 'Waiting Confirmation',
        delivery_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT,
        activity TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed User Default jika kosong
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (row && row.count === 0) {
            const salt = bcrypt.genSaltSync(10);
            db.run("INSERT INTO users (name, email, password, role) VALUES ('Lecture Evaluator Admin', 'admin@pasarkita.com', ?, 'admin')", [bcrypt.hashSync('admin123', salt)]);
            db.run("INSERT INTO users (name, email, password, role) VALUES ('John Doe', 'john@gmail.com', ?, 'user')", [bcrypt.hashSync('user123', salt)]);
        }
    });
});

function logActivity(userName, activity) {
    db.run("INSERT INTO activity_logs (user_name, activity) VALUES (?, ?)", [userName, activity]);
}

/* ================= ROUTER API SQL SERVICE ================= */
app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body;
    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [name, email, hash], function(err) {
        if (err) return res.status(400).json({ error: 'Email sudah terdaftar.' });
        logActivity(name, 'User registration');
        res.json({ success: true });
    });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err || !user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Email atau password salah' });
        }
        logActivity(user.name, 'User login');
        res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    });
});

app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => { res.json(rows); });
});

app.post('/api/products', (req, res) => {
    const { title, price, profit, category, image, adminName } = req.body;
    db.run("INSERT INTO products (title, price, profit, category, image) VALUES (?, ?, ?, ?, ?)", [title, price, profit, category, image], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        logActivity(adminName || 'Admin', `Created product: ${title}`);
        res.json({ success: true, id: this.lastID });
    });
});

app.put('/api/products/:id', (req, res) => {
    const { title, price, profit, category, image, adminName } = req.body;
    let query = "UPDATE products SET title = ?, price = ?, profit = ?, category = ?";
    let params = [title, price, profit, category];
    if (image) { query += ", image = ?"; params.push(image); }
    query += " WHERE id = ?"; params.push(req.params.id);

    db.run(query, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        logActivity(adminName || 'Admin', `Updated product ID: ${req.params.id}`);
        res.json({ success: true });
    });
});

app.delete('/api/products/:id', (req, res) => {
    const { adminName } = req.body;
    db.run("DELETE FROM products WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        logActivity(adminName || 'Admin', `Deleted product ID: ${req.params.id}`);
        res.json({ success: true });
    });
});

app.post('/api/products/:id/view', (req, res) => {
    db.run("UPDATE products SET views = views + 1 WHERE id = ?", [req.params.id], () => { res.json({ success: true }); });
});

app.post('/api/orders', (req, res) => {
    const { userId, userName, productName, totalPrice, profit, address } = req.body;
    db.run("INSERT INTO orders (user_id, product_name, total_price, profit, status, delivery_address) VALUES (?, ?, ?, ?, 'Waiting Confirmation', ?)",
        [userId, productName, totalPrice, profit, address], function() {
            logActivity(userName, `Checkout Order #${this.lastID}`);
            res.json({ success: true });
    });
});

app.get('/api/orders/user/:userId', (req, res) => {
    db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC", [req.params.userId], (err, rows) => { res.json(rows); });
});

app.post('/api/orders/:id/status', (req, res) => {
    const { status, userName } = req.body;
    db.run("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id], () => {
        res.json({ success: true });
    });
});

app.get('/api/admin/dashboard', (req, res) => {
    const data = {};
    db.get("SELECT COUNT(*) as count FROM users WHERE role='user'", (err, r) => { data.totalUsers = r.count;
    db.get("SELECT COUNT(*) as count FROM orders", (err, r) => { data.totalOrders = r.count;
    db.get("SELECT IFNULL(SUM(total_price), 0) as sum FROM orders", (err, r) => { data.totalRevenue = r.sum;
    db.get("SELECT IFNULL(SUM(profit), 0) as sum FROM orders", (err, r) => { data.totalProfit = r.sum;
    db.get("SELECT COUNT(*) as count FROM products", (err, r) => { data.totalProducts = r.count;
        db.all("SELECT * FROM activity_logs ORDER BY id DESC LIMIT 30", (err, logs) => {
            data.logs = logs;
            res.json(data);
        });
    }); }); }); }); });
});

app.listen(PORT, () => console.log(`🚀 Fullscreen SQL app running on http://localhost:${PORT}`));