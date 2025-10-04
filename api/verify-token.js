import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        return res.status(500).json({ error: 'Configuration missing' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: 'Invalid token' });
        
        return res.status(200).json({ valid: true, user: { id: user.id, email: user.email } });
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
