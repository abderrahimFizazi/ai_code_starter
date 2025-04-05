const express = require('express');
const path = require('path');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { OpenAI } = require('openai'); // Use the single OpenAI import
require('dotenv').config(); // Load environment variables from .env file

const app = express();
const PORT = process.env.PORT || 3000;

// --- Initialize Clients ---

// Gemini
const geminiApiKey = process.env.GEMINI_API_KEY;
let genAI;
if (geminiApiKey) {
    try {
        genAI = new GoogleGenerativeAI(geminiApiKey);
        console.log("Google Gemini API Client Initialized.");
    } catch (error) {
        console.error("Error initializing Google Gemini Client:", error.message);
    }
} else {
    console.warn("GEMINI_API_KEY not found. Gemini generation disabled.");
}

// OpenAI (Actual)
const openaiApiKey = process.env.OPENAI_API_KEY;
let openai; // Client for OpenAI service
if (openaiApiKey) {
     try {
        openai = new OpenAI({ apiKey: openaiApiKey });
        console.log("OpenAI API Client Initialized.");
    } catch (error) {
         console.error("Error initializing OpenAI Client:", error.message);
    }
} else {
    console.warn("OPENAI_API_KEY not found. OpenAI generation disabled.");
}

// DeepSeek (using OpenAI SDK)
const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
let deepseekClient; // Separate client instance for DeepSeek
if (deepseekApiKey) {
    try {
        // Initialize OpenAI SDK configured for DeepSeek endpoint
        deepseekClient = new OpenAI({
            baseURL: 'https://api.deepseek.com/v1', // Use v1 endpoint for SDK compatibility
            apiKey: deepseekApiKey
        });
        console.log("DeepSeek Client (via OpenAI SDK) Initialized.");
    } catch(error) {
        console.error("Error initializing DeepSeek Client:", error.message);
    }
} else {
    console.warn("DEEPSEEK_API_KEY not found. DeepSeek generation disabled.");
}
// --- END CLIENT INITIALIZATION ---


// --- Hardcoded Base Prompt ---
const basePromptInstructions = `You are an expert web developer specializing in building dynamic, responsive, single-page websites based on user descriptions.

### Instructions:
1. **Generate a full HTML document** with proper semantic structure (header, main, footer, nav, section, etc.). Include reasonable placeholder content derived from the user request.
2. **Keep CSS and JavaScript separate**:
   - CSS: Define relevant styling for layout, colors, and typography using modern techniques (Flexbox, Grid, CSS Variables, media queries). Ensure basic responsiveness. Add comments explaining CSS rules.
   - JS: Implement dynamic behavior *only if requested or clearly implied* (e.g., simple form validation, mobile menu toggle). If no logic is specified, add only a basic console log like "console.log('Page loaded successfully.');". Add comments explaining JS logic.
3. **Output Format (Strict JSON)**:
   Respond **only** with a single, valid JSON object containing three keys:
   - \`finalHtml\`: A string containing the full HTML document (<!DOCTYPE html>...).
   - \`css\`: A string containing all the generated CSS code.
   - \`js\`: A string containing all the generated JavaScript code.

### JSON Output Example:
\`\`\`json
{
  "finalHtml": "<!DOCTYPE html>\\n<html lang=\"en\">\\n<head>\\n  <meta charset=\"UTF-8\">\\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\\n  <title>Example Page</title>\\n  <link rel=\"stylesheet\" href=\"style.css\">\\n</head>\\n<body>\\n  <h1>Simple Example</h1>\\n  <p>This is placeholder content.</p>\\n  <script src=\"script.js\"></script>\\n</body>\\n</html>",
  "css": "/* Basic styling */\\nbody {\\n  font-family: sans-serif;\\n  line-height: 1.6;\\n  margin: 20px;\\n}\\nh1 {\\n  color: #333;\\n}",
  "js": "// Log when the page is loaded\\nconsole.log('Page loaded successfully.');"
}
\`\`\`
- **Important**: Ensure the entire response is *only* this JSON object. No introductory text, explanations, apologies, or markdown formatting around the JSON.
- If the user request is too vague, unethical, or impossible to fulfill, generate a simple placeholder HTML page explaining the issue briefly within the 'finalHtml' field, and provide empty strings for 'css' and 'js', still adhering strictly to the JSON format.`;


// Default Model Names
const DEFAULT_GEMINI_MODEL_NAME = "gemini-1.5-pro-latest";
const DEFAULT_OPENAI_MODEL_NAME = "gpt-4o";
const DEFAULT_DEEPSEEK_MODEL_NAME = "deepseek-coder"; // Use coder by default

// --- Gemini Configuration ---
const geminiGenerationConfig = { /* ... */ };
const geminiSafetySettings = [ /* ... */ ];

// --- Utility Functions ---
function cleanJsonResponse(text) { 
    if (!text) return '';
    let cleanedText = text.trim();
    if (cleanedText.startsWith('```json')) cleanedText = cleanedText.slice(7, -3).trim();
    else if (cleanedText.startsWith('```')) cleanedText = cleanedText.slice(3, -3).trim();
    return cleanedText;
}
function parseAndValidateResponse(responseText, providerName) { 
    let parsedResult;
    try { parsedResult = JSON.parse(responseText); }
    catch (parseError) {
        console.error(`Failed to parse ${providerName} JSON: ${parseError.message}`);
        console.error(`Raw response text (first 500 chars): ${responseText.substring(0, 500)}`);
        throw new Error(`${providerName} API returned invalid JSON.`);
    }
    if (!parsedResult || typeof parsedResult.finalHtml !== 'string' || typeof parsedResult.css !== 'string' || typeof parsedResult.js !== 'string') {
        console.error(`Parsed ${providerName} response missing keys/invalid types:`, parsedResult);
        throw new Error(`${providerName} response JSON structure incorrect. Expected {finalHtml, css, js}.`);
    }
    return { html: parsedResult.finalHtml, css: parsedResult.css, js: parsedResult.js };
}

// --- API Call Functions ---
async function callRealGeminiAPI(userPrompt, modelName = DEFAULT_GEMINI_MODEL_NAME) { 
    if (!genAI) throw new Error("Gemini API client not available.");
    console.log(`Calling Gemini API (Model: ${modelName})...`);
    const fullPrompt = `${basePromptInstructions}\n\n## User Request:\n"${userPrompt}"`;
    const model = genAI.getGenerativeModel({ model: modelName, generationConfig: geminiGenerationConfig, safetySettings: geminiSafetySettings });
    try {
        const result = await model.generateContent(fullPrompt);
        const response = result.response;
        if (!response) throw new Error("Gemini API returned no response.");
        if (response.promptFeedback?.blockReason) throw new Error(`Content generation blocked: ${response.promptFeedback.blockReason}`);
        const responseText = response.text();
        if (!responseText) throw new Error("Gemini API returned empty text.");
        const cleanedText = cleanJsonResponse(responseText);
        const validatedResult = parseAndValidateResponse(cleanedText, 'Gemini');
        console.log("Success: Gemini generation complete.");
        return validatedResult;
    } catch (error) {
        if (error instanceof Error && (error.message.includes('invalid JSON') || error.message.includes('structure incorrect') || error.message.includes('blocked'))) throw error;
        console.error(`Error calling Gemini API (Model: ${modelName}):`, error);
        throw new Error(`Gemini API Error: ${error.message || 'Unknown error'}`);
    }
}
async function callOpenAIAPI(userPrompt, modelName = DEFAULT_OPENAI_MODEL_NAME) { 
    if (!openai) throw new Error("OpenAI API client not available.");
    console.log(`Calling OpenAI API (Model: ${modelName})...`);
    const systemPrompt = basePromptInstructions;
    const userMessage = `User Request: "${userPrompt}"`;
    try {
        const completion = await openai.chat.completions.create({
            model: modelName,
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
            response_format: { type: "json_object" }, temperature: 0.7,
        });
        const responseText = completion.choices[0]?.message?.content;
        if (!responseText) throw new Error("OpenAI API returned empty response content.");
        const validatedResult = parseAndValidateResponse(responseText, 'OpenAI');
        console.log("Success: OpenAI generation complete.");
        return validatedResult;
    } catch (error) {
        if (error instanceof Error && (error.message.includes('invalid JSON') || error.message.includes('structure incorrect'))) throw error;
        console.error(`Error calling OpenAI API (Model: ${modelName}):`, error);
        throw new Error(`OpenAI API Error: ${error.message || 'Unknown error'}`);
    }
}

// --- DEEPSEEK API IMPLEMENTATION ---
async function callDeepSeekAPI(userPrompt, modelName = DEFAULT_DEEPSEEK_MODEL_NAME) {
     console.log(`Calling DeepSeek API (Model: ${modelName})...`);
     if (!deepseekClient) { // Check if the specific DeepSeek client is initialized
         throw new Error("DeepSeek API client not configured/available on the server.");
     }

     const systemPrompt = basePromptInstructions;
     const userMessage = `User Request: "${userPrompt}"`;

     try {
         const completion = await deepseekClient.chat.completions.create({
             model: modelName, // e.g., "deepseek-coder" or "deepseek-chat" from models.json
             messages: [
                 { role: "system", content: systemPrompt },
                 { role: "user", content: userMessage }
             ],
             // IMPORTANT: Do NOT assume DeepSeek supports 'response_format: json_object'
             // We will parse the text response instead.
             temperature: 0.7, // Adjust as needed
             // max_tokens: 4096, // Optional
             // stream: false, // Ensure not streaming
         });

         const responseText = completion.choices[0]?.message?.content;
         if (!responseText) {
             throw new Error("DeepSeek API returned empty response content.");
         }

         // DeepSeek might return markdown fences, clean it
         const cleanedText = cleanJsonResponse(responseText);
         const validatedResult = parseAndValidateResponse(cleanedText, 'DeepSeek');

         console.log("Success: DeepSeek generation complete.");
         return validatedResult;

     } catch (error) {
         // Don't re-wrap specific parsing errors
         if (error instanceof Error && (error.message.includes('invalid JSON') || error.message.includes('structure incorrect'))) {
             throw error;
         }
         console.error(`Error calling DeepSeek API (Model: ${modelName}):`, error);
         // Check for specific API errors if the DeepSeek SDK provides them
         throw new Error(`DeepSeek API Error: ${error.message || 'Unknown error'}`);
     }
}
// --- END DEEPSEEK ---

// Placeholder/Error function for any OTHER unsupported provider
async function callUnsupportedProviderAPI(providerName, modelName) {
    console.warn(`Generation request for unsupported provider "${providerName}" (Model: ${modelName})`);
    throw new Error(`Provider "${providerName}" is not currently supported by the backend.`);
}


// --- Middleware ---
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/constants', express.static(path.join(__dirname, 'constants')));

// --- API Endpoints ---
app.get('/api/models', (req, res) => { 
     const modelsPath = path.join(__dirname, 'constants', 'models.json');
     res.sendFile(modelsPath, (err) => {
         if (err) {
             console.error("Error sending models.json:", err);
             res.status(err.status || 500).json({ error: "Could not load models configuration." });
         } else {
            // console.log("Served models.json successfully."); // Reduce noise
         }
     });
});

app.post('/generate', async (req, res) => {
    const provider = req.body.provider?.toLowerCase();
    const modelName = req.body.modelName;
    const prompt = req.body.prompt;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }
    if (!provider || typeof provider !== 'string') {
         return res.status(400).json({ error: `Provider is required.` });
    }

    console.log(`Received generation request. Provider: ${provider}, Model: ${modelName || 'Default'}, Prompt: "${prompt.substring(0, 50)}..."`);

    try {
        let result;
        switch (provider) {
            case 'openai':
                if (!openai) throw new Error("OpenAI API Client not configured/available.");
                result = await callOpenAIAPI(prompt, modelName || DEFAULT_OPENAI_MODEL_NAME);
                break;
            case 'gemini':
                 if (!genAI) throw new Error("Gemini API Client not configured/available.");
                result = await callRealGeminiAPI(prompt, modelName || DEFAULT_GEMINI_MODEL_NAME);
                break;
            case 'deepseek':
                // The API key/client availability check is now inside callDeepSeekAPI
                result = await callDeepSeekAPI(prompt, modelName || DEFAULT_DEEPSEEK_MODEL_NAME);
                break;
            default:
                // Handle any other provider listed in models.json but not implemented
                console.warn(`Received request for unimplemented provider "${provider}".`);
                result = await callUnsupportedProviderAPI(provider, modelName); // This will throw
                break;
        }
        res.json(result);

    } catch (error) {
        console.error(`Error during generation for provider ${provider}:`, error);
        const statusCode = error.message?.includes('blocked') ? 400 :
                           error.message?.includes('not configured') ? 501 :
                           error.message?.includes('not supported') ? 501 :
                           500;
        // Ensure error.message exists and is a string before sending
        const errorMessage = (error instanceof Error && error.message) ? error.message : 'An unexpected server error occurred.';
        res.status(statusCode).json({ error: errorMessage });
    }
});

// --- Serve Frontend ---
app.get('*', (req, res) => { 
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, (err) => {
      if (err) {
          console.error("Error sending index.html for /* route:", err);
          res.status(err.status || 500).send("Error loading application page.");
      }
  });
});

// --- Start Server ---
app.listen(PORT, () => { 
    console.log(`AI Web Weaver server listening on http://localhost:${PORT}`);
    if (!geminiApiKey) console.warn("(!) GEMINI_API_KEY is not set. Gemini generation disabled.");
    if (!openaiApiKey) console.warn("(!) OPENAI_API_KEY is not set. OpenAI generation disabled.");
    if (!deepseekApiKey) console.warn("(!) DEEPSEEK_API_KEY is not set. DeepSeek generation disabled.");
});