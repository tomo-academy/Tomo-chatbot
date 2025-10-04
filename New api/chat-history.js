import { createClient } from '@supabase/supabase-js';
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
  // Handle different HTTP methods
  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'DELETE':
      return handleDelete(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

// Handle GET request - fetch chat history
async function handleGet(req, res) {
  // Load environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Validate environment variables
  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Server configuration missing' });
  }

  // Initialize Supabase admin client
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Verify Firebase token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication token required' });
    }
    
    const decodedToken = await getAuth().verifyIdToken(token);
    const userId = decodedToken.uid;

    // Fetch chat history from Supabase
    const { data: chats, error: chatsError } = await supabaseAdmin
      .from('chats')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (chatsError) {
      console.error('Error fetching chats:', chatsError);
      return res.status(500).json({ error: 'Failed to fetch chat history' });
    }

    // Fetch messages for each chat
    const sessions = await Promise.all(chats.map(async (chat) => {
      const { data: messages, error: messagesError } = await supabaseAdmin
        .from('messages')
        .select('*')
        .eq('chat_id', chat.id)
        .order('created_at', { ascending: true });

      if (messagesError) {
        console.error('Error fetching messages:', messagesError);
        return {
          id: chat.id,
          title: chat.title,
          created_at: chat.created_at,
          messages: []
        };
      }

      return {
        id: chat.id,
        title: chat.title,
        created_at: chat.created_at,
        messages: messages || []
      };
    }));

    return res.status(200).json({ sessions });
  } catch (error) {
    console.error('Chat history API error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

// Handle DELETE request - delete chat(s)
async function handleDelete(req, res) {
  // Load environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Validate environment variables
  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Server configuration missing' });
  }

  // Initialize Supabase admin client
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Verify Firebase token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication token required' });
    }
    
    const decodedToken = await getAuth().verifyIdToken(token);
    const userId = decodedToken.uid;

    // Get chat ID from query parameters
    const { sessionId } = req.query;
    
    if (sessionId) {
      // Delete specific chat
      // First verify the chat belongs to the user
      const { data: chat, error: chatError } = await supabaseAdmin
        .from('chats')
        .select('id')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .single();

      if (chatError || !chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      // Delete messages first (foreign key constraint)
      const { error: messagesError } = await supabaseAdmin
        .from('messages')
        .delete()
        .eq('chat_id', sessionId);

      if (messagesError) {
        console.error('Error deleting messages:', messagesError);
        return res.status(500).json({ error: 'Failed to delete messages' });
      }

      // Delete the chat
      const { error: deleteError } = await supabaseAdmin
        .from('chats')
        .delete()
        .eq('id', sessionId);

      if (deleteError) {
        console.error('Error deleting chat:', deleteError);
        return res.status(500).json({ error: 'Failed to delete chat' });
      }

      return res.status(200).json({ success: true });
    } else {
      // Delete all chats for the user
      // First delete all messages
      const { data: userChats, error: userChatsError } = await supabaseAdmin
        .from('chats')
        .select('id')
        .eq('user_id', userId);

      if (userChatsError) {
        console.error('Error fetching user chats:', userChatsError);
        return res.status(500).json({ error: 'Failed to fetch user chats' });
      }

      if (userChats && userChats.length > 0) {
        const chatIds = userChats.map(chat => chat.id);
        
        // Delete all messages for these chats
        const { error: messagesError } = await supabaseAdmin
          .from('messages')
          .delete()
          .in('chat_id', chatIds);

        if (messagesError) {
          console.error('Error deleting messages:', messagesError);
          return res.status(500).json({ error: 'Failed to delete messages' });
        }

        // Delete all chats
        const { error: deleteError } = await supabaseAdmin
          .from('chats')
          .delete()
          .eq('user_id', userId);

        if (deleteError) {
          console.error('Error deleting chats:', deleteError);
          return res.status(500).json({ error: 'Failed to delete chats' });
        }
      }

      return res.status(200).json({ success: true });
    }
  } catch (error) {
    console.error('Chat history API error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
