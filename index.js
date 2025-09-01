const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const { initializeDatabase, pool } = require('./config/database');
const { authenticateToken, requireAdmin } = require('./middleware/auth');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for image uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Middleware
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Image upload routes - Add these before other routes
app.post('/api/upload/image', authenticateToken, requireAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'No image file uploaded'
      });
    }

    const imageBuffer = req.file.buffer;
    const result = await pool.query(
      'INSERT INTO product_images (image_data, mime_type, file_size) VALUES ($1, $2, $3) RETURNING id',
      [imageBuffer, req.file.mimetype, req.file.size]
    );

    res.status(201).json({
      message: 'Image uploaded successfully',
      imageId: result.rows[0].id
    });
  } catch (error) {
    console.error('Image upload error:', error);
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'File too large',
          message: 'Image size must be less than 5MB'
        });
      }
    }
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while uploading the image'
    });
  }
});

// Serve images
app.get('/api/image/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT image_data, mime_type FROM product_images WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Image not found',
        message: 'Image with the specified ID does not exist'
      });
    }

    const { image_data, mime_type } = result.rows[0];
    res.set('Content-Type', mime_type);
    res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.send(image_data);
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving the image'
    });
  }
});

// Main route
app.get('/', (req, res) => {
  res.json({ 
    message: 'E-commerce API Server is running!',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      products: '/api/products',
      reviews: '/api/reviews',
      orders: '/api/orders',
      upload: '/api/upload/image',
      image: '/api/image/:id'
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

// Error handling middleware for multer and general errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: 'Image size must be less than 5MB'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Invalid file',
        message: 'Only one image file is allowed'
      });
    }
  }
  
  if (error.message === 'Only image files are allowed') {
    return res.status(400).json({
      error: 'Invalid file type',
      message: 'Only image files are allowed'
    });
  }

  console.error(error.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: error.message 
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
      console.log('Image upload endpoint: POST /api/upload/image');
      console.log('Image serve endpoint: GET /api/image/:id');
      console.log('API Documentation: Check README.md for detailed API usage');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
