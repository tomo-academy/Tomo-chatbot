import { streamText, generateText } from 'ai';
import { xai } from '@ai-sdk/xai';
import { createClient } from '@supabase/supabase-js';

// Supported xAI models (aligned with your frontend <select id="model">)
const languageModels = {
  'grok-4': 'grok-4-latest',
  'grok-3': 'grok-3-latest',
  'grok-3-fast': 'grok-3-fast-latest',
  'grok-3-mini': 'grok-3-mini-latest',
  'grok-3-mini-fast': 'grok-3-mini-fast-latest',
};

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Load environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const xaiApiKey = process.env.XAI_API_KEY;

  // Validate environment variables
  if (!supabaseUrl || !supabaseServiceKey || !xaiApiKey) {
    return res.status(500).json({ error: 'Server configuration missing' });
  }

  // Initialize Supabase admin client
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Parse request body
    const { messages, model = 'grok-4', stream = true, userId, chatId } = req.body;

    // Basic validation
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages are required and must be an array' });
    }
    if (!languageModels[model]) {
      return res.status(400).json({ error: `Invalid model: ${model}` });
    }

    // Verify JWT token if userId is provided (for authenticated users)
    let verifiedUserId = null;
    if (userId) {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'Authentication token required' });
      }
      
      try {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !user || user.id !== userId) {
          return res.status(401).json({ error: 'Invalid or unauthorized token' });
        }
        verifiedUserId = user.id;
      } catch (authError) {
        console.error('Authentication error:', authError);
        return res.status(401).json({ error: 'Authentication failed' });
      }
    }

    // Initialize xAI model
    const modelInstance = xai(languageModels[model]);

    let generatedText = '';
    let newChatId = chatId;
    let sessionTitle = null;

    // Handle streaming response
    if (stream) {
      try {
        const { textStream } = await streamText({
          model: modelInstance,
          messages,
          temperature: 0.7,
          maxTokens: 2048,
        });

        // Set headers for Server-Sent Events (SSE)
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control',
        });

        // Stream response and collect full text for Supabase
        const reader = textStream.getReader();
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = new TextDecoder().decode(value);
            generatedText += chunk;
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
          }
          res.write('data: [DONE]\n\n');

          // Save to Supabase for authenticated users (non-blocking)
          if (verifiedUserId) {
            saveToSupabase(
              verifiedUserId,
              messages,
              generatedText,
              newChatId,
              sessionTitle,
              supabaseAdmin
            ).catch(error => {
              console.error('Error saving to Supabase:', error);
            });
          }
        } catch (streamError) {
          console.error('Stream error:', streamError);
          res.write(`data: ${JSON.stringify({ error: 'Stream failed: ' + streamError.message })}\n\n`);
        } finally {
          res.end();
        }
      } catch (modelError) {
        console.error('Model initialization error:', modelError);
        return res.status(500).json({ error: 'Failed to initialize AI model: ' + modelError.message });
      }
      return;
    } else {
      // Handle non-streaming response
      try {
        const { text } = await generateText({
          model: modelInstance,
          messages,
          temperature: 0.7,
          maxTokens: 2048,
        });
        generatedText = text;

        // Save to Supabase for authenticated users
        if (verifiedUserId) {
          ({ newChatId, sessionTitle } = await saveToSupabase(
            verifiedUserId,
            messages,
            generatedText,
            chatId,
            null,
            supabaseAdmin
          ));
        }

        // Return JSON response
        return res.status(200).json({
          choices: [{ message: { content: generatedText } }],
          sessionId: newChatId,
          sessionTitle,
        });
      } catch (generateError) {
        console.error('Text generation error:', generateError);
        return res.status(500).json({ error: 'Failed to generate response: ' + generateError.message });
      }
    }
  } catch (error) {
    console.error('Chat API error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

// Helper function to save chat and messages to Supabase
async function saveToSupabase(userId, messages, generatedText, chatId, sessionTitle, supabase) {
  let newChatId = chatId;

  try {
    if (!chatId) {
      // Generate a title for new chats
      const firstUserContent = messages.find(m => m.role === 'user')?.content || 'New chat';
      sessionTitle = generateChatTitle(firstUserContent);

      // Insert new chat
      const { data, error } = await supabase
        .from('chats')
        .insert({ user_id: userId, title: sessionTitle })
        .select('id')
        .single();
      
      if (error) {
        console.error('Error creating chat:', error);
        throw new Error('Failed to create chat');
      }
      newChatId = data.id;

      // Insert all messages including the new assistant response
      const allMessages = [
        ...messages,
        { role: 'assistant', content: generatedText },
      ];
      const inserts = allMessages.map(msg => ({
        chat_id: newChatId,
        role: msg.role,
        content: msg.content,
      }));
      const { error: msgError } = await supabase.from('messages').insert(inserts);
      if (msgError) {
        console.error('Error saving messages:', msgError);
        throw new Error('Failed to save messages');
      }
    } else {
      // Append last user message and assistant response to existing chat
      const lastUserMessage = messages[messages.length - 1];
      const inserts = [
        { chat_id: chatId, role: lastUserMessage.role, content: lastUserMessage.content },
        { chat_id: chatId, role: 'assistant', content: generatedText },
      ];
      const { error } = await supabase.from('messages').insert(inserts);
      if (error) {
        console.error('Error appending messages:', error);
        throw new Error('Failed to append messages');
      }
    }

    return { newChatId, sessionTitle };
  } catch (error) {
    console.error('Error in saveToSupabase:', error);
    throw error;
  }
}

// Helper function to generate chat title (mirrors frontend logic)
function generateChatTitle(content) {
  const cleanContent = content.replace(/[#*`_~\[\]()]/g, '').trim();
  const words = cleanContent.split(/\s+/).filter(word => word.length > 2);
  const titleWords = words.slice(0, Math.min(3, words.length));
  let title = titleWords.join(' ');
  if (title.length > 20) title = title.substring(0, 17) + '...';
  return title || 'New chat';
}
