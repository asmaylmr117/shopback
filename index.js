const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();

// Middleware الأساسي - بدون أخطاء محتملة
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint - تأكد من أن هذا المسار صحيح
app.get('/', (req, res) => {
  res.json({ 
    message: 'E-commerce API Server is running!',
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// API root endpoint - تأكد من أن هذا المسار صحيح
app.get('/api', (req, res) => {
  res.status(200).json({
    message: '🟢 API root is working fine',
    now: new Date().toISOString()
  });
});

// ⚠️ تعطيل جميع المسارات التي قد تحتوي على معلمات بشكل مؤقت
// قم بتعليق كل ما يلي مؤقتًا:

/*
// Configure multer - قد يكون هناك مشكلة هنا
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4.5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Image upload endpoint - قد يكون هناك مشكلة في المعلمات
app.post('/api/upload/image', upload.single('image'), async (req, res) => {
  res.status(201).json({
    message: 'Image upload endpoint disabled for testing'
  });
});

// Serve images endpoint - هنا قد تكون المشكلة في :id
app.get('/api/image/:id', async (req, res) => {
  res.status(200).json({
    message: 'Image serve endpoint disabled for testing'
  });
});

// محاولة استيراد الـ middleware والروتات - تعطيل مؤقت
try {
  // const { pool } = require('./config/database');
  // const { authenticateToken, requireAdmin } = require('./middleware/auth');
  
  // const authRoutes = require('./routes/auth');
  // const productRoutes = require('./routes/products');
  // const reviewRoutes = require('./routes/reviews');
  // const orderRoutes = require('./routes/orders');

  // app.use('/api/auth', authRoutes);
  // app.use('/api/products', productRoutes);
  // app.use('/api/reviews', reviewRoutes);
  // app.use('/api/orders', orderRoutes);
  
  console.log('All routes disabled for testing');
} catch (error) {
  console.error('Error in optional imports:', error);
}
*/

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error occurred:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: 'Something went wrong'
  });
});

// Handle 404s
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist'
  });
});

console.log('Server started with minimal configuration');
module.exports = app;
