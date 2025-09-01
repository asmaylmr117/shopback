const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { initializeDatabase } = require('./config/database');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'E-commerce API Server is running!',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      products: '/api/products',
      reviews: '/api/reviews',
      orders: '/api/orders'
    }
  });
});

// Import route modules - Let's test each one individually
console.log('Loading auth routes...');
const authRoutes = require('./routes/auth');
console.log('Auth routes loaded successfully');

console.log('Loading product routes...');
const productRoutes = require('./routes/products');
console.log('Product routes loaded successfully');

console.log('Loading review routes...');
const reviewRoutes = require('./routes/reviews');
console.log('Review routes loaded successfully');

console.log('Loading order routes...');
const orderRoutes = require('./routes/orders');
console.log('Order routes loaded successfully');

// Use routes - Comment out one by one to identify the problematic route
console.log('Registering auth routes...');
app.use('/api/auth', authRoutes);

console.log('Registering product routes...');
app.use('/api/products', productRoutes);

console.log('Registering review routes...');
app.use('/api/reviews', reviewRoutes);

console.log('Registering order routes...');
app.use('/api/orders', orderRoutes);

console.log('All routes registered successfully');

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: err.message 
  });
});



// Start server
const startServer = async () => {
  try {
    // Initialize database
    console.log('Initializing database...');
    await initializeDatabase();
    console.log('Database initialized successfully');

    // Start the server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Access the API at: http://localhost:${PORT}`);
      console.log('API Documentation: Check README.md for detailed API usage');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
