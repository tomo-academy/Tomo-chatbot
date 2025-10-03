import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Supabase configuration missing' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { action, provider } = req.body;

  try {
    if (action === 'signIn') {
      if (!provider) {
        return res.status(400).json({ error: 'Provider is required' });
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: req.headers.origin || 'https://your-vercel-app.vercel.app',
        },
      });

      if (error) throw error;
      return res.status(200).json({ url: data.url });
    } else if (action === 'getUser') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No token provided' });

      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error) throw error;

      return res.status(200).json({ user });
    } else if (action === 'signOut') {
      // Sign out is handled client-side, but we can verify token if needed
      return res.status(200).json({ success: true });
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
