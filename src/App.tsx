/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { AudioPlayer, AudioRecorder } from './lib/audioUtils';
import { systemInstruction, allTools, MENU_PRICES } from './lib/geminiTools';

type CartItem = {
  item_id?: number | string;
  item_name: string;
  quantity: number;
  price: number;
};

export default function App() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [menu, setMenu] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('Pulao');
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('IDLE READY');
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const aiRef = useRef<GoogleGenAI | null>(null);
  const sessionRef = useRef<any>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const isRecordingRef = useRef(false);
  const isSpeakingRef = useRef(false);

  useEffect(() => {
    aiRef.current = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    recorderRef.current = new AudioRecorder();
    playerRef.current = new AudioPlayer();
    
    playerRef.current.onQueueEmpty = () => {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      setStatus('IDLE READY');
    };

    // Fetch menu on load
    fetch('/api/menu')
      .then(res => res.json())
      .then(data => {
        setMenu(data);
        console.log("Menu Loaded:", data.length, "items");
      })
      .catch(err => console.error("Menu Fetch Error:", err));
    
    return () => {
      recorderRef.current?.destroy();
      playerRef.current?.stop();
      sessionRef.current?.close();
    };
  }, []);

  const connectToGemini = async () => {
    if (!aiRef.current) return;
    setStatus('CONNECTING...');

    await new Promise<void>(async (resolve) => {
      const sessionPromise = aiRef.current!.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: systemInstruction,
          tools: [{ functionDeclarations: allTools }],
        },
        callbacks: {
          onopen: () => {
            setStatus('CONNECTED');
            setIsConnected(true);
            resolve(); // Resolve here, not when sessionPromise resolves
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.turnComplete) {
              // audio may still be playing — onQueueEmpty fires when playback actually finishes
            }
            if (message.serverContent?.modelTurn) {
              const parts = message.serverContent.modelTurn.parts || [];
              for (const part of parts) {
                if (part.inlineData?.data) {
                  isSpeakingRef.current = true;
                  setIsSpeaking(true);
                  playerRef.current?.playPCM(part.inlineData.data, 24000);
                  setStatus('SPEAKING');
                }
              }
            }
            if (message.serverContent?.interrupted) {
              playerRef.current?.stop();
            }
            if (message.toolCall && sessionRef.current) {
              const functionResponses = [];
              for (const call of message.toolCall.functionCalls || []) {
                if (call.name === 'add_item') {
                  const args = call.args as any;
                  // Find item in the REAL menu to get ID and correct price
                  const item = menu.find(m => m.name.toLowerCase() === args.item_name.toLowerCase());
                  
                  if (item) {
                    setCart(prev => {
                      const existing = prev.find(i => i.item_name === item.name);
                      if (existing) {
                        return prev.map(i => i.item_name === item.name ? { ...i, quantity: i.quantity + (args.quantity || 1) } : i);
                      }
                      return [...prev, { 
                        item_id: item.id,
                        item_name: item.name, 
                        quantity: args.quantity || 1, 
                        price: item.price 
                      }];
                    });
                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: { result: `Added ${args.quantity || 1} ${item.name} to cart.` }
                    });
                  } else {
                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: { error: `Item '${args.item_name}' not found. Please try again with a valid item name.` }
                    });
                  }
                } else if (call.name === 'remove_item') {
                  setCart(prev => prev.filter(i => i.item_name !== (call.args as any).item_name));
                  functionResponses.push({
                    id: call.id,
                    name: call.name,
                    response: { result: "Item removed successfully." }
                  });
                } else if (call.name === 'clear_cart') {
                  setCart([]);
                  functionResponses.push({
                    id: call.id,
                    name: call.name,
                    response: { result: "Cart cleared." }
                  });
                } else if (call.name === 'confirm_order') {
                  submitOrder();
  
                  functionResponses.push({
                    id: call.id,
                    name: call.name,
                    response: { result: "Order submitted to the kitchen." }
                  });
                }
              }
              if (functionResponses.length > 0) {
                sessionRef.current.sendToolResponse({ functionResponses });
              }
            }
          },
          onerror: (e) => setStatus('ERROR: ' + e?.message),
          onclose: () => {
            setStatus('IDLE READY');
            setIsConnected(false);
            sessionRef.current = null;
          }
        }
      });
  
      sessionRef.current = await sessionPromise;
    });

    // Send an initial empty turn to suppress proactive greetings
    sessionRef.current?.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: '' }] }],
      turnComplete: false
    });
  };

  const handleMouseDown = async () => {
    if (isSpeakingRef.current) {
      playerRef.current?.stop();
      isSpeakingRef.current = false;
      setIsSpeaking(false);
    }

    isRecordingRef.current = true;
    setIsRecording(true);
    setStatus('LISTENING');

    if (!sessionRef.current) {
      await connectToGemini();
    }

    await recorderRef.current?.start((base64) => {
      if (isRecordingRef.current && sessionRef.current) {
        sessionRef.current.sendRealtimeInput({
          audio: { data: base64, mimeType: 'audio/pcm;rate=16000' }
        });
      }
    });
  };

  const handleMouseUp = () => {
    if (!isRecordingRef.current) return;

    isRecordingRef.current = false;
    setIsRecording(false);

    recorderRef.current?.stop();

    if (sessionRef.current) {
      try {
        sessionRef.current.sendRealtimeInput({ audioStreamEnd: true });
        setStatus('PROCESSING...');
      } catch (e) {
        console.error('audioStreamEnd error', e);
      }
    }
  };

  const submitOrder = () => {
    if (cart.length === 0) return;
    setStatus('SUBMITTING...');
    
    const formattedItems = cart.map(item => ({
      menu_item_id: item.item_id,
      quantity: item.quantity
    }));

    fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: "Voice Kiosk User",
        items: formattedItems
      })
    })
    .then(res => res.json())
    .then(data => {
      console.log("Order Sync:", data.success ? `Order ID: ${data.orderId}` : "Sync Failed: " + data.error);
      if (data.success) {
        setCart([]);
        setStatus('ORDER CONFIRMED');
        setTimeout(() => setStatus('IDLE READY'), 3000);
      } else {
        setStatus('SYNC ERROR');
      }
    })
    .catch(err => {
      console.error("Database Error:", err);
      setStatus('SYNC ERROR');
    });

    if (sessionRef.current) {
      sessionRef.current.close();
    }
  };

  const clearCart = () => {
    setCart([]);
    setStatus('IDLE READY');
    if (sessionRef.current) {
       sessionRef.current.close(); 
    }
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const gst = Math.round(subtotal * 0.15);
  const total = subtotal + gst;

  return (
    <div className="p-8 flex gap-8 w-full h-full select-none">
      <aside className="w-64 flex flex-col gap-6">
        <div className="p-2">
          <h1 className="text-2xl font-serif font-bold text-[#5A5A40]">SAVOUR FOODS</h1>
          <p className="text-xs tracking-widest uppercase opacity-60">Islamabad / Blue Area</p>
        </div>

        <nav className="flex flex-col gap-2 overflow-y-auto max-h-[60vh]">
          {['Pulao', 'Burgers', 'Fried', 'Deals', 'Desserts', 'Beverages', 'Breakfast', 'Sides', 'Seasonal'].map(cat => (
            <div 
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`sidebar-item p-4 rounded-r-lg cursor-pointer transition-all ${selectedCategory === cat ? 'active' : 'opacity-70 hover:opacity-100 hover:bg-white/10'}`}
            >
              <p className="font-semibold">{cat}</p>
              <p className="text-[10px] opacity-50 uppercase">
                {menu.filter(m => m.category === cat).length} Items
              </p>
            </div>
          ))}
        </nav>

        <div className="mt-auto glass-panel p-4">
          <p className="text-[10px] uppercase tracking-tighter opacity-50 mb-2">System Status</p>
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-xs font-mono">GEMINI 3.1 FLASH LIVE</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span className="text-xs font-mono">LOCAL DB: SYNCED</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 flex flex-col glass-panel relative overflow-hidden">
          {/* Menu Items Grid or PTT View */}
          <div className="flex-1 p-8 overflow-y-auto">
            <h2 className="text-2xl font-serif text-[#5A5A40] mb-6">{selectedCategory} Menu</h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {menu.length === 0 ? (
                <div className="col-span-full py-20 text-center opacity-40">Loading menu...</div>
              ) : (
                menu.filter(item => item.category === selectedCategory).map(item => (
                  <div key={item.id} className="p-4 bg-white/40 rounded-xl border border-white/40 hover:border-[#A39171]/40 transition-all group">
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="font-bold text-[#5A5A40]">{item.name}</h4>
                      <span className="font-mono text-sm">PKR {item.price}</span>
                    </div>
                    <p className="text-xs opacity-60 line-clamp-2 mb-3">{item.description}</p>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 bg-white/60 rounded">{item.size}</span>
                      <button 
                         onClick={() => {
                           setCart(prev => {
                             const existing = prev.find(i => (i as any).item_id === item.id);
                             if (existing) {
                               return prev.map(i => (i as any).item_id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
                             }
                             return [...prev, { item_id: item.id, item_name: item.name, quantity: 1, price: item.price }];
                           });
                         }}
                         className="text-[10px] font-bold uppercase tracking-widest bg-[#5A5A40] text-white px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        Add to Cart
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Voice Interface Overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col items-center pointer-events-none z-50">
            <div className="w-full h-24 bg-gradient-to-t from-[#F8F7F2] to-transparent absolute bottom-0 left-0 right-0 pointer-events-none"></div>
            <div 
              className={`ptt-ring relative flex items-center justify-center cursor-pointer transition-all duration-300 pointer-events-auto z-10 shadow-2xl ${
                isRecording ? 'scale-90 bg-red-600 shadow-red-200' :
                isSpeaking  ? 'bg-gray-400 cursor-not-allowed' :
                'bg-[#5A5A40]'
              }`}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleMouseDown}
              onTouchEnd={handleMouseUp}
              style={{ width: '120px', height: '120px' }}
            >
              <div className={`flex items-end gap-1 h-6 ${isRecording ? 'animate-pulse' : ''}`}>
                <div className="wave-line w-1 h-3 bg-white"></div>
                <div className="wave-line w-1 h-6 bg-white"></div>
                <div className="wave-line w-1 h-4 bg-white"></div>
                <div className="wave-line w-1 h-8 bg-white"></div>
                <div className="wave-line w-1 h-3 bg-white"></div>
              </div>
            </div>
            <p className="mt-3 font-bold text-[#5A5A40] tracking-widest uppercase text-[10px] pointer-events-none z-10 drop-shadow-sm">
              {isRecording ? 'Listening...' : isSpeaking ? 'Gemini Speaking...' : 'Push to Talk'}
            </p>
          </div>
        </div>
      </main>

      <aside className="w-80 flex flex-col">
        <div className="glass-panel flex-1 flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-xl font-bold">Current Order</h3>
            <p className="text-xs opacity-50">Cart Items: {cart.length}</p>
          </div>

          <div className="flex-1 p-6 flex flex-col gap-4 overflow-y-auto">
            {cart.length === 0 ? (
              <p className="text-xs opacity-50 italic text-center mt-10">Your cart is empty.</p>
            ) : (
              cart.map((item, idx) => (
                <div key={idx} className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-sm">
                      {item.quantity}x {item.item_name}
                    </p>
                  </div>
                  <span className="font-mono text-sm">PKR {item.price * item.quantity}</span>
                </div>
              ))
            )}
          </div>

          <div className="p-6 bg-[#5A5A40] text-[#F8F7F2] rounded-b-[24px]">
            <div className="flex justify-between mb-2 opacity-80">
              <span className="text-sm">Subtotal</span>
              <span className="text-sm">PKR {subtotal}</span>
            </div>
            <div className="flex justify-between mb-4">
              <span className="text-sm opacity-80">Sales Tax (GST)</span>
              <span className="text-sm">PKR {gst}</span>
            </div>
            <div className="flex justify-between items-end border-t border-white/20 pt-4">
              <span className="text-xl font-serif">Total</span>
              <span className="text-2xl font-bold">PKR {total}</span>
            </div>
            
            <div className="mt-6 flex flex-col gap-2">
              <button 
                onClick={submitOrder}
                disabled={cart.length === 0}
                className={`w-full py-3 rounded-lg font-bold uppercase tracking-widest text-xs transition-colors ${cart.length > 0 ? 'bg-[#A39171] text-white cursor-pointer hover:bg-[#928263]' : 'bg-white/20 text-white/40 cursor-not-allowed'}`}
              >
                Confirm Order
              </button>
              <button 
                 onClick={clearCart}
                 className="w-full py-2 border border-white/20 rounded-lg text-xs opacity-70 cursor-pointer hover:bg-white/10 transition-colors">
                 Clear All Items
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
