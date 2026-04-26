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

  // External API Config
  const EXTERNAL_API_URL = 'https://voiceai-hzyb.onrender.com';

  // API Route: Get Menu from external API
  app.get('/api/menu', async (req, res) => {
    try {
      const response = await axios.get(`${EXTERNAL_API_URL}/menu`);
      res.json(response.data);
    } catch (err: any) {
      console.error('External Menu API Error:', err.message);
      res.status(500).json({ error: 'Failed to fetch menu from external source' });
    }
  });

  // API Route: Create Order in external API
  app.post('/api/orders', async (req, res) => {
    const { customer_name, items } = req.body;
    console.log('📦 Incoming Order request:', JSON.stringify(req.body));
    
    try {
      // items looks like: [{ menu_item_id: 1, quantity: 2 }, ...]
      const response = await axios.post(`${EXTERNAL_API_URL}/orders`, {
        customer_name: customer_name || 'Voice Kiosk User',
        items: items
      });
      
      // Also optionally log to local Supabase if configured (as a backup)
      if (supabase) {
        const { error: syncError } = await supabase.from('orders').insert([{ 
          items, 
          external_order_id: response.data.id,
          status: 'synced_to_render' 
        }]);
        if (syncError) console.warn('Supabase local sync failed:', syncError.message);
      }

      res.status(201).json({ success: true, orderId: response.data.id });
    } catch (err: any) {
      console.error('External Order API Error:', err.response?.data || err.message);
      res.status(500).json({ 
        success: false, 
        error: err.response?.data?.detail || err.message 
      });
    }
  });

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
