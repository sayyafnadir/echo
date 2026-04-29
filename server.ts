import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Supabase Client Initialization (Lazy/Resilient)
  const getSupabase = () => {
    const url = (process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_KEY || '').trim();
    
    if (!url || !key) {
      console.error('❌ Supabase Env Missing: URL length:', url.length, 'Key length:', key.length);
      return null;
    }
    
    // Log masked keys for debugging
    console.log(`📡 Connecting to Supabase: ${url.substring(0, 15)}...`);
    console.log(`🔑 Using Key starting with: ${key.substring(0, 10)}...`);
    
    return createClient(url, key);
  };

  const supabase = getSupabase();

  // External API Config — AI adapter backend
  const BACKEND_URL = process.env.BACKEND_URL || 'https://voiceai-hzyb.onrender.com';

  // ── Generic agent proxy helper ──────────────────────────────
  const proxyGet = async (path: string, req: any, res: any) => {
    try {
      const url = new URL(BACKEND_URL + path);
      // Forward any query params
      Object.entries(req.query as Record<string, string>).forEach(([k, v]) => url.searchParams.set(k, v));
      const response = await axios.get(url.toString());
      // If backend returns plain text (menu-context) don't force JSON
      const ct = String(response.headers['content-type'] || '');
      if (ct.includes('text/plain') || typeof response.data === 'string') {
        res.type('text/plain').send(response.data);
      } else {
        res.json(response.data);
      }
    } catch (err: any) {
      console.error(`GET ${path} error:`, err.response?.data || err.message);
      res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
    }
  };

  const proxyPost = async (path: string, req: any, res: any, successStatus = 200) => {
    try {
      const response = await axios.post(BACKEND_URL + path, req.body);
      res.status(successStatus).json(response.data);
    } catch (err: any) {
      console.error(`POST ${path} error:`, err.response?.data || err.message);
      res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
    }
  };

  // ── Agent routes (used by Gemini tool call handlers) ─────────

  // Full menu as Markdown — called once at session start and injected into system prompt
  app.get('/api/agent/menu-context', (req, res) => proxyGet('/api/v1/agent/menu-context', req, res));

  // Resolve a dish + modifiers → validate required options → add to server-side cart
  app.post('/api/agent/resolve-item', (req, res) => proxyPost('/api/v1/agent/resolve-item', req, res));

  // Remove a cart item by cart_item_id
  app.post('/api/agent/remove-item', (req, res) => proxyPost('/api/v1/agent/remove-item', req, res));

  // Clear entire session cart
  app.post('/api/agent/clear-cart', (req, res) => proxyPost('/api/v1/agent/clear-cart', req, res));

  // View current cart (used by the UI to display cart state)
  app.get('/api/agent/cart/:sessionId', (req, res) => proxyGet(`/api/v1/agent/cart/${req.params.sessionId}`, req, res));

  // Submit finalised order to the database
  app.post('/api/agent/submit-order', (req, res) => proxyPost('/api/v1/agent/submit-order', req, res, 201));

  // ── Legacy menu read (kept for the menu display grid in the UI) ─
  app.get('/api/menu', (req, res) => proxyGet('/api/v1/menu', req, res));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    const url = (process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_KEY || '').trim();
    
    // Safety check for quotes (common mistake)
    const hasQuotes = (key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"));
    
    // Deeper inspection: Try to extract project ref from URL and Key
    const urlMatches = url.match(/https:\/\/(.*?)\.supabase\.co/);
    const urlProjectRef = urlMatches ? urlMatches[1] : null;
    
    let keyProjectRef = null;
    try {
      const parts = key.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        keyProjectRef = payload.ref || payload.project || null;
      }
    } catch (e) {
      // Ignore parsing errors
    }
    
    res.json({ 
      status: 'ok', 
      supabaseConfigured: !!url && !!key,
      url: {
        prefix: url.substring(0, 15),
        length: url.length,
        projectRef: urlProjectRef
      },
      key: {
        prefix: key.substring(0, 10),
        suffix: key.substring(key.length - 5),
        length: key.length,
        hasQuotes: hasQuotes,
        segmentCount: key.split('.').length,
        projectRefFromKey: keyProjectRef
      },
      mismatch: !!urlProjectRef && !!keyProjectRef && urlProjectRef !== keyProjectRef,
      nodeEnv: process.env.NODE_ENV || 'development'
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
