import { db, FIRESTORE_DATABASE_ID } from '../lib/firebaseAdmin.ts';

async function initDb() {
  console.log(`Initializing database for project: [DEFAULT], database: ${FIRESTORE_DATABASE_ID}...`);
  
  try {
    await db.collection('healthcheck').doc('ping').set({
      status: 'ok',
      updatedAt: new Date().toISOString()
    });
    console.log('Healthcheck document created.');
  } catch (error) {
    console.error('Error creating healthcheck document:', error);
  }
}

initDb();
