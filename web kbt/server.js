const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite database in-memory or file
const db = new sqlite3.Database(':memory:', (err) => {
    if (err) console.error('Database connection failed:', err);
    else console.log('Connected to SQLite in-memory database.');
});

// Setup Schema Tables
db.serialize(() => {
    // Users
    db.run(`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Products
    db.run(`CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        price REAL,
        profit REAL,
        category TEXT,
        views INTEGER DEFAULT 0
    )`);

    // Orders
    db.run(`CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        product_name TEXT,
        total_price REAL,
        profit REAL,
        status TEXT,
        delivery_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Activity Logs
    db.run(`CREATE TABLE activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT,
        activity TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed Initial Data
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('admin123', salt);
    db.run("INSERT INTO users (name, email, password, role) VALUES ('Lecture Evaluator Admin', 'admin@pasarkita.com', ?, 'admin')", [hash]);
    db.run("INSERT INTO users (name, email, password, role) VALUES ('John Doe', 'john@gmail.com', ?, 'user')", [bcrypt.hashSync('user123', salt)]);

    // Seed Marketplace Products
    db.run("INSERT INTO products (title, price, profit, category) VALUES ('Sverom chair', 65000, 15000, 'Chair')");
    db.run("INSERT INTO products (title, price, profit, category) VALUES ('Mini sit me', 75000, 20000, 'Chair')");
    db.run("INSERT INTO products (title, price, profit, category) VALUES ('Old Chair', 75000, 10000, 'Chair')");
});

// Logging Helper
function logActivity(userName, activity) {
    db.run("INSERT INTO activity_logs (user_name, activity) VALUES (?, ?)", [userName, activity]);
}

/* ================= AUTHENTICATION ENDPOINTS ================= */
app.post('/api/auth/register', (express.json()), (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing parameters' });

    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [name, email, hash], function(err) {
        if (err) return res.status(400).json({ error: 'Email already exists' });
        logActivity(name, 'User registration');
        res.json({ success: true, message: 'Account successfully registered!' });
    });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err || !user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Invalid email or password credentials' });
        }
        logActivity(user.name, 'User login');
        res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    });
});

/* ================= MARKETPLACE ENDPOINTS ================= */
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/products/:id/view', (req, res) => {
    const { userName } = req.body;
    db.run("UPDATE products SET views = views + 1 WHERE id = ?", [req.params.id], function() {
        logActivity(userName || 'Guest', `Product view (ID: ${req.params.id})`);
        res.json({ success: true });
    });
});

app.post('/api/orders', (req, res) => {
    const { userId, userName, productName, totalPrice, profit, address } = req.body;
    db.run("INSERT INTO orders (user_id, product_name, total_price, profit, status, delivery_address) VALUES (?, ?, ?, ?, 'Waiting Confirmation', ?)",
        [userId, productName, totalPrice, profit, address], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logActivity(userName, `Checkout - Ordered ${productName}`);
            res.json({ success: true, orderId: this.lastID });
    });
});

app.get('/api/orders/user/:userId', (req, res) => {
    db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC", [req.params.userId], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/orders/:id/status', (req, res) => {
    const { status, userName } = req.body;
    db.run("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id], function() {
        if (status === 'Completed') {
            logActivity(userName || 'Admin', `Order completed (Order ID: ${req.params.id})`);
        }
        res.json({ success: true });
    });
});

/* ================= ADMIN ANALYTICS ENDPOINTS ================= */
app.get('/api/admin/dashboard', (req, res) => {
    const data = {};
    db.get("SELECT COUNT(*) as count FROM users WHERE role='user'", (err, r) => { data.totalUsers = r.count;
    db.get("SELECT COUNT(*) as count FROM orders", (err, r) => { data.totalOrders = r.count;
    db.get("SELECT IFNULL(SUM(total_price), 0) as sum FROM orders", (err, r) => { data.totalRevenue = r.sum;
    db.get("SELECT IFNULL(SUM(profit), 0) as sum FROM orders", (err, r) => { data.totalProfit = r.sum;
    db.get("SELECT COUNT(*) as count FROM products", (err, r) => { data.totalProducts = r.count;
    
    // Growth metrics grouped chronologically
    db.all("SELECT DATE(created_at) as date, COUNT(*) as count FROM users WHERE role='user' GROUP BY date", (err, rUsers) => { data.usersGrowth = rUsers;
    db.all("SELECT DATE(created_at) as date, COUNT(*) as count, SUM(total_price) as rev, SUM(profit) as prof FROM orders GROUP BY date", (err, rOrders) => {
        data.ordersGrowth = rOrders;
        
        // Dynamic logs history
        db.all("SELECT * FROM activity_logs ORDER BY id DESC LIMIT 50", (err, logs) => {
            data.logs = logs;
            res.json(data);
        });
    }); }); }); }); }); }); });
});

app.listen(PORT, () => console.log(`Pasar Kita server securely deployed on http://localhost:${PORT}`));