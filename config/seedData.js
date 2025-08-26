
const { pool } = require('./database');

// Products data from the provided file
const products = [
  {name: 'T-shirt with Tape Details', stars: 4.5, price: 120, discount: 0, category: 'newarrival', style: 'Casual', style2: 'Party', type: 'T-shirts', type2: 'All', image_url: '../1.png'},
  {name: 'Skinny Fit Jeans', stars: 3.5, price: 240, discount: 20, category: 'newarrival', style: 'Formal', style2: 'Casual', type: 'Jeans', type2: 'All', image_url: '../2.png'},
  {name: 'Checkered Shirt', stars: 4.5, price: 180, discount: 0, category: 'newarrival', style: 'Formal', style2: 'Party', type: 'Shirts', type2: 'All', image_url: '../3.png'},
  {name: 'Sleeve Striped T-shirt', stars: 4.5, price: 130, discount: 30, category: 'newarrival', style: 'Casual', style2: 'Party', type: 'T-shirts', type2: 'All', image_url: '../4.png'},
  {name: 'Vertical Striped Shirt', stars: 5, price: 212, discount: 20, category: 'newarrival', style: 'Formal', style2: '', type: 'Shirts', type2: 'All', image_url: '../5.png'},
  {name: 'Courage Graphic T-shirt', stars: 4, price: 145, discount: 0, category: 'newarrival', style: 'Casual', style2: 'Party', type: 'T-shirts', type2: 'All', image_url: '../6.png'},
  {name: 'Loose Fit Bermuda Shorts', stars: 4.5, price: 240, discount: 20, category: 'topselling', style: 'Party', style2: '', type: 'Shorts', type2: 'All', image_url: '../7.png'},
  {name: 'Faded Skinny Jeans', stars: 4.5, price: 210, discount: 0, category: 'topselling', style: 'Formal', style2: '', type: 'Jeans', type2: 'All', image_url: '../8.png'},
  {name: 'One Life Graphic T-shirt', stars: 4.5, price: 260, discount: 40, category: 'onsale', style: 'Casual', style2: 'Party', type: 'T-shirts', type2: 'All', image_url: '../9.png'},
  {name: 'Polo with Contrast Trims', stars: 4, price: 212, discount: 20, category: 'onsale', style: 'Casual', style2: '', type: 'T-shirts', type2: 'All', image_url: '../11.png'},
  {name: 'Gradient Graphic T-shirt', stars: 3.5, price: 145, discount: 0, category: 'shop', style: 'Casual', style2: '', type: 'T-shirts', type2: 'All', image_url: '../12.png'},
  {name: 'Polo with Tipping Details', stars: 4.5, price: 180, discount: 0, category: 'shop', style: 'Casual', style2: '', type: 'T-shirts', type2: 'All', image_url: '../13.png'},
  {name: 'Black Striped T-shirt', stars: 5, price: 120, discount: 30, category: 'shop', style: 'Casual', style2: '', type: 'T-shirts', type2: 'All', image_url: '../14.png'},
  {name: 'Relaxed Fit Twill Utility Shorts', stars: 5, price: 260, discount: 10, category: 'shop', style: 'Party', style2: '', type: 'Shorts', type2: 'All', image_url: '../15.png'}
];

// Site reviews data
const siteReviews = [
  {name: 'Sarah M.', review: "I'm blown away by the quality and style of the clothes I received from Shop.co. From casual wear to elegant dresses, every piece I've bought has exceeded my expectations.", rating: 5},
  {name: 'Alex K.', review: "Finding clothes that align with my personal style used to be a challenge until I discovered Shop.co. The range of options they offer is truly remarkable, catering to a variety of tastes and occasions.", rating: 5},
  {name: 'James L.', review: "As someone who's always on the lookout for unique fashion pieces, I'm thrilled to have stumbled upon Shop.co. The selection of clothes is not only diverse but also on-point with the latest trends.", rating: 4.5},
  {name: 'Mooen', review: "As someone who's always on the lookout for unique fashion pieces, I'm thrilled to have stumbled upon Shop.co. The selection of clothes is not only diverse but also on-point with the latest trends.", rating: 4.5},
  {name: 'Samantha D.', review: "I'm blown away by the quality and style of the clothes I received from Shop.co. From casual wear to elegant dresses, every piece I've bought has exceeded my expectations.", rating: 5}
];

// Function to seed products
const seedProducts = async () => {
  try {
    // Clear existing products
    await pool.query('DELETE FROM products');
    
    // Insert products
    for (const product of products) {
      await pool.query(`
        INSERT INTO products (name, stars, price, discount, category, style, style2, type, type2, image_url, stock_quantity)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        product.name,
        product.stars,
        product.price,
        product.discount,
        product.category,
        product.style,
        product.style2,
        product.type,
        product.type2,
        product.image_url,
        Math.floor(Math.random() * 100) + 10 // Random stock between 10-110
      ]);
    }
    
    console.log('Products seeded successfully');
  } catch (error) {
    console.error('Error seeding products:', error);
    throw error;
  }
};

// Function to seed reviews
const seedReviews = async () => {
  try {
    // Clear existing reviews
    await pool.query('DELETE FROM reviews');
    
    // Insert reviews
    for (const review of siteReviews) {
      await pool.query(`
        INSERT INTO reviews (name, review, rating)
        VALUES ($1, $2, $3)
      `, [review.name, review.review, review.rating]);
    }
    
    console.log('Reviews seeded successfully');
  } catch (error) {
    console.error('Error seeding reviews:', error);
    throw error;
  }
};

// Function to create admin user
const createAdminUser = async () => {
  try {
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
    
    // Check if admin already exists
    const existingAdmin = await pool.query('SELECT * FROM users WHERE username = $1', [process.env.ADMIN_USERNAME]);
    
    if (existingAdmin.rows.length === 0) {
      await pool.query(`
        INSERT INTO users (username, email, password, role)
        VALUES ($1, $2, $3, $4)
      `, [process.env.ADMIN_USERNAME, 'admin@shop.co', hashedPassword, 'admin']);
      
      console.log('Admin user created successfully');
    } else {
      console.log('Admin user already exists');
    }
  } catch (error) {
    console.error('Error creating admin user:', error);
    throw error;
  }
};

// Main seed function
const seedDatabase = async () => {
  try {
    await createAdminUser();
    await seedProducts();
    await seedReviews();
    console.log('Database seeded successfully');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
};

module.exports = {
  seedDatabase,
  seedProducts,
  seedReviews,
  createAdminUser
};