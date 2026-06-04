const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('========================================');
    console.error('  FATAL: JWT_SECRET is not set!');
    console.error('  Set the environment variable:');
    console.error('  Windows: set JWT_SECRET=your-secret-key');
    console.error('  Linux/Mac: export JWT_SECRET=your-secret-key');
    console.error('========================================');
    process.exit(1);
}

function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: user.role,
            full_name: user.full_name
        },
        JWT_SECRET,
        { expiresIn: '1h' }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(403).json({ error: 'Invalid or expired token.' });
    }

    req.user = decoded;
    next();
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
}

module.exports = {
    generateToken,
    verifyToken,
    authenticateToken,
    requireAdmin,
    JWT_SECRET
};