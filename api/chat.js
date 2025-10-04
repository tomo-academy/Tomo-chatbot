export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      messages, 
      model = 'llama-3.3-70b-versatile',
      stream = false,
      userId = null 
    } = req.body;

    // Validate messages
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages are required and must be an array' });
    }

    // Validate message roles
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message.role || !['system', 'user', 'assistant'].includes(message.role)) {
        return res.status(400).json({ 
          error: `Invalid role at messages[${i}]: '${message.role}'. Role must be one of: system, user, assistant` 
        });
      }
      if (!message.content || typeof message.content !== 'string') {
        return res.status(400).json({ 
          error: `Invalid content at messages[${i}]: Content must be a non-empty string` 
        });
      }
    }

    // Format user ID if provided
    let formattedUserId = 'anonymous';
    if (userId) {
      // Format the user ID to be more readable
      formattedUserId = userId
        .replace(/[^a-zA-Z0-9]/g, '') // Remove special characters
        .substring(0, 8); // Limit to 8 characters
    }

    // Get API key from environment variables
    const apiKey = process.env.GROQ_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Prepare request to Groq API
    const groqRequest = {
      model,
      messages,
      temperature: 0.7,
      max_tokens: 2048
    };

    // Add streaming if requested
    if (stream) {
      groqRequest.stream = true;
    }

    // If streaming is requested, set up streaming response
    if (stream) {
      // Set headers for Server-Sent Events
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      });

      try {
        // Make request to Groq API with streaming
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(groqRequest)
        });

        if (!response.ok) {
          const errorData = await response.json();
          res.write(`data: ${JSON.stringify({ error: errorData.error?.message || 'API request failed' })}\n\n`);
          res.end();
          return;
        }

        // Get the reader from the response body
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Process the stream
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          // Decode the chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });
          
          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep the incomplete line in the buffer
          
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.substring(6));
                res.write(`data: ${JSON.stringify(data)}\n\n`);
              } catch (e) {
                console.error('Error parsing JSON:', e);
              }
            }
          }
        }
        
        // Send the final [DONE] message
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (error) {
        console.error('Error in streaming API:', error);
        res.write(`data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming response (original behavior)
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(groqRequest)
      });

      if (!response.ok) {
        const errorData = await response.json();
        return res.status(response.status).json({ 
          error: errorData.error?.message || 'API request failed' 
        });
      }

      const data = await response.json();
      
      // Add user information to the response
      data.userId = formattedUserId;
      
      return res.status(200).json(data);
    }
  } catch (error) {
    console.error('Error in chat API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
