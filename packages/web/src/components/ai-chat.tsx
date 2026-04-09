import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, Send, X, Bot, User, Loader2, Minimize2, Maximize2 } from 'lucide-react';
import { aiChat, type AiChatMessage } from '../api.js';

interface AiChatProps {
  accountId: string;
  accountName?: string;
}

export function AiChatPanel({ accountId, accountName }: AiChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMessage: AiChatMessage = { role: 'user', content: trimmed };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setError(null);
    setLoading(true);

    try {
      const response = await aiChat(accountId, newMessages);
      setMessages([...newMessages, { role: 'assistant', content: response.reply }]);
      setModelInfo(`${response.model} | ${response.tokens} tokens | ${(response.latencyMs / 1000).toFixed(1)}s`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка AI');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const suggestions = [
    'Какие основные риски у этого аккаунта?',
    'Стоит ли менять домен?',
    'Почему упал Quality Score?',
    'Как продлить lifetime аккаунта?',
    'Какие кампании стоит поставить на паузу?',
  ];

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-all hover:scale-105"
        style={{
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <MessageCircle size={20} />
        <span className="text-sm font-medium">AI Chat</span>
      </button>
    );
  }

  const panelWidth = isExpanded ? 640 : 420;
  const panelHeight = isExpanded ? 'calc(100vh - 40px)' : 520;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col rounded-xl shadow-2xl overflow-hidden"
      style={{
        width: panelWidth,
        height: panelHeight,
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff' }}
      >
        <div className="flex items-center gap-2">
          <Bot size={18} />
          <div>
            <div className="text-sm font-semibold">AI Ассистент</div>
            <div className="text-xs opacity-80">{accountName ?? accountId}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setIsExpanded(!isExpanded)} className="p-1.5 rounded hover:bg-white/20 transition">
            {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button onClick={() => setIsOpen(false)} className="p-1.5 rounded hover:bg-white/20 transition">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="space-y-3">
            <div className="text-center py-4">
              <Bot size={32} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Задайте вопрос об аккаунте
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                AI имеет полный контекст: кампании, баны, метрики, домены
              </p>
            </div>
            <div className="space-y-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s);
                    inputRef.current?.focus();
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs transition hover:brightness-110"
                  style={{
                    background: 'var(--bg-card)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-1"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                <Bot size={14} color="#fff" />
              </div>
            )}
            <div
              className="max-w-[85%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap"
              style={msg.role === 'user'
                ? { background: '#6366f1', color: '#fff', borderBottomRightRadius: 4 }
                : { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderBottomLeftRadius: 4 }
              }
            >
              {msg.content}
            </div>
            {msg.role === 'user' && (
              <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-1"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                <User size={14} style={{ color: 'var(--text-muted)' }} />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-2">
            <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Bot size={14} color="#fff" />
            </div>
            <div className="px-3 py-2 rounded-xl text-sm flex items-center gap-2"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
              <Loader2 size={14} className="animate-spin" />
              Анализирую...
            </div>
          </div>
        )}

        {error && (
          <div className="px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Model info */}
      {modelInfo && (
        <div className="px-4 py-1 text-center" style={{ fontSize: 9, color: 'var(--text-ghost)' }}>
          {modelInfo}
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Задайте вопрос..."
            rows={1}
            className="flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              maxHeight: 100,
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="flex-shrink-0 p-2 rounded-lg transition"
            style={{
              background: input.trim() && !loading ? '#6366f1' : 'var(--bg-card)',
              color: input.trim() && !loading ? '#fff' : 'var(--text-muted)',
              border: '1px solid var(--border-subtle)',
              opacity: !input.trim() || loading ? 0.5 : 1,
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
