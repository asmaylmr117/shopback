const { initializeDatabase } = require('./config/database');
const { seedDatabase } = require('./config/seedData');

async function init() {
  try {
    console.log('Initializing database...');
    await initializeDatabase();
    
    console.log('Seeding database with initial data...');
    await seedDatabase();
    
    console.log('Database initialization completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

init();
