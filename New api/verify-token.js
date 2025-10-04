import { getAuth } from 'firebase-admin/auth';
import { initializeApp } from 'firebase-admin/app';

// Initialize Firebase Admin SDK if not already initialized
const firebaseConfig = {
  projectId: "tomo-3c4bc",
};

if (!getAuth().app) {
  initializeApp(firebaseConfig);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await getAuth().verifyIdToken(token);
    
    return res.status(200).json({
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      displayName: decodedToken.name,
      photoURL: decodedToken.picture
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
}
