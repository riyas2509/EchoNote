import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import firebaseConfig from '../firebase-applet-config.json';

async function initDb() {
  if (getApps().length === 0) {
    initializeApp();
  }
  // Use the default database if possible, or the one from config
  const db = getFirestore(firebaseConfig.firestoreDatabaseId); 
  
  console.log(`Initializing database for project: [DEFAULT], database: ${firebaseConfig.firestoreDatabaseId}...`);
  
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
