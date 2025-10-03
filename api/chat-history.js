import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Configuration missing' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Verify token
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, created_at, messages(id, role, content, created_at)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ sessions: data });
    } else if (req.method === 'DELETE') {
      const sessionId = req.query.sessionId;

      if (sessionId) {
        const { error } = await supabase.from('chats').delete().eq('id', sessionId).eq('user_id', user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('chats').delete().eq('user_id', user.id);
        if (error) throw error;
      }

      return res.status(200).json({ success: true });
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('History error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
