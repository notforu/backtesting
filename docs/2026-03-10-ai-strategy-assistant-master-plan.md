# AI Strategy Assistant — Мастер-план

**Date**: 2026-03-10
**Status**: Master plan (pre-implementation)

---

## Резюме

Превращаем бэктестинг-платформу в SaaS-продукт с AI-ассистентом, который генерирует торговые стратегии из описания на естественном языке. Пользователь общается как с ChatGPT, получает **полноценный код стратегии** (TypeScript), тут же бэктестит, запускает paper trading и (в будущем) реальных ботов.

Двухуровневый подход:
- **Уровень 1 — Конфигурация** (80% запросов): маппинг на существующие 14 стратегий + параметры. Дёшево, безопасно, мгновенно.
- **Уровень 2 — Генерация кода** (20% запросов): LLM генерирует полный TypeScript-файл стратегии с произвольной логикой. Максимальная гибкость.

---

## 1. Архитектура AI-ассистента

### 1.1 Уровень 1: Конфигурация существующих стратегий

Для 80% запросов: LLM маппит описание пользователя на одну из 14 существующих стратегий + подбирает параметры. Это:

- **Безопасно** — нет необходимости в sandbox для пользовательского кода
- **Дёшево** — Claude Sonnet с tool_use, ~$0.03 за диалог
- **Быстро в разработке** — 2-3 дня на MVP
- **Надёжно** — Zod-валидация отлавливает невалидные конфиги

#### Как это работает:

```
1. Пользователь пишет:
   "Хочу стратегию на фандинг рейтах для BTC, консервативную"

2. LLM получает system prompt со всеми стратегиями и их параметрами

3. LLM через tool_use вызывает:
   select_strategy(name, params, symbol, timeframe)

4. Backend валидирует через Zod и возвращает готовую конфигурацию

5. Фронтенд показывает карточку стратегии с кнопкой "Run Backtest"
```

#### System prompt structure:

```json
{
  "strategies": [
    {
      "name": "FundingRateCarry",
      "description": "Шорт переоцененных активов на фандинг рейтах",
      "parameters": {
        "fundingThreshold": { "min": 0.0001, "max": 0.005, "default": 0.0003, "description": "%" },
        "leverage": { "min": 1, "max": 3, "default": 1.5 },
        "positionSize": { "min": 0.1, "max": 1.0, "default": 0.5, "description": "% от капитала" }
      },
      "bestFor": "Боковый рынок с высокими фандинг рейтами",
      "riskLevel": "medium"
    }
    // ... остальные 13 стратегий
  ],
  "instructions": "Choose strategy based on user description..."
}
```

#### Tool use schema:

```typescript
// tools.ts
const tools = [
  {
    name: "select_strategy",
    description: "Генерирует конфигурацию стратегии на основе описания пользователя",
    input_schema: {
      type: "object",
      properties: {
        strategy_name: { type: "string", enum: ["FundingRateCarry", "MomentumMean", "..."] },
        parameters: {
          type: "object",
          description: "Параметры стратегии, валидируются против schema"
        },
        symbol: { type: "string", example: "BTC/USDT" },
        timeframe: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"] },
        explanation: { type: "string", description: "Почему выбрана эта стратегия" }
      },
      required: ["strategy_name", "parameters", "symbol", "timeframe"]
    }
  }
];
```

---

### 1.2 Уровень 2: Генерация кода стратегий (PRIMARY)

Для 20% запросов, требующих произвольной логики: LLM генерирует полный TypeScript-файл стратегии. Это основной вектор дифференциации продукта.

#### Полная поверхность API для генерации кода:

```
Данные (read-only):
  • candleView — OHLCV свечи (closes(), highs(), lows(), volumes(), at(), slice())
  • fundingRates — массив funding rate events (futures)
  • currentFundingRate — текущий FR event или null
  • currentCandle — текущая свеча
  • currentIndex — индекс текущего бара
  • portfolio — snapshot портфеля (cash, equity, longPosition, shortPosition)
  • balance, equity, longPosition, shortPosition — convenience accessors

Торговые действия:
  • openLong(amount) — открыть лонг
  • closeLong(amount?) — закрыть лонг (partial или full)
  • openShort(amount) — открыть шорт
  • closeShort(amount?) — закрыть шорт

Утилиты:
  • log(message) — логирование
  • setIndicator(name, value) — вывод индикатора на график

Доступные индикаторы (technicalindicators):
  • Trend: EMA, SMA, MACD, ADX
  • Volatility: ATR, BollingerBands, CCI
  • Momentum: RSI, Stochastic, TRIX
  • Custom: percentile rank, ROC, gradient — через код
```

#### Паттерны, доступные для генерации:

```
Входы: crossovers, threshold breaks, multi-indicator confirmation,
       regime detection, time-window, divergence

Выходы: ATR-based SL/TP, trailing stop, time-based, indicator reversal,
        regime change, thesis invalidation

Sizing: fixed %, volatility-adjusted, leverage-adjusted, fractional Kelly

Фильтры: trend alignment, volatility gates, cooldown, epoch limits,
          volume confirmation, RSI filters

State: произвольное состояние через this (entry price, trail stop,
       trade counters, epoch tracking, etc.)
```

#### Pipeline генерации кода:

```
User prompt
  → Claude Sonnet (tool_use: generate_strategy_code)
  → TypeScript код стратегии
  → tsc compile check (синтаксис)
  → AST forbidden patterns check (безопасность: process, require, import, eval, fetch, globalThis)
  → Zod schema validation (params array)
  → isolated-vm dry run на 10 свечах (smoke test)
  → ✅ Ready for backtest
```

#### Sandbox (isolated-vm):

- V8 isolate: startup ~1ms, memoryLimit 128MB, CPU timeout 100ms per onBar()
- Zero access to Node.js APIs, filesystem, network
- Whitelist: только StrategyContext methods + pre-bundled technicalindicators
- Worker thread wrapper для параллелизма

#### Ограничения системы (что пользователь НЕ может):

- Multi-timeframe анализ (только один TF на стратегию) — планируется
- Cross-asset signals (торговать ETH по сигналу BTC) — планируется через aggregation
- Order book (L2) данные — нет
- ML-модели напрямую — можно через pre-computed features
- Limit/stop orders — только market orders в бэктесте

---

### 1.3 LLM стратегия: API сначала, self-hosted при масштабе

```
Фаза 1 (0-5000 генераций/мес): Claude Sonnet API
  • Cost: ~$0.03/генерация ($150/мес max)
  • Качество: лучшее в индустрии для кодогенерации
  • Интеграция: 1-2 дня

Фаза 2 (5000+ генераций/мес): Гибрид
  • Простые запросы (конфигурация, FAQ): self-hosted Qwen2.5-Coder-14B
  • Сложные запросы (генерация кода): Claude Sonnet API
  • Требуется: GPU VPS или dedicated server с GPU

Фаза 3 (масштаб): Fine-tuned self-hosted
  • Fine-tune Qwen2.5-Coder-14B/32B на strategy API
  • Dedicated GPU server (RTX 3090/4090, ~$100-200/мес)
  • Fallback на Claude API для edge cases

Экономика self-hosted:
  • GPU VPS (A100): ~$200-400/мес
  • Break-even: ~7,000 генераций/мес
  • CPU-only (Hetzner EX44, 128GB RAM): ~$60/мес, но ~30-40s на ответ
  • Рекомендация: не переходить на self-hosted до 5000 генераций/мес
```

### Модель: Claude Sonnet (основная) / Haiku (простые запросы)

| Модель | Cost per generation | Use case |
|--------|-------------------|----------|
| Claude Haiku | ~$0.003 | Простые вопросы, объяснения, FAQ |
| Claude Sonnet | ~$0.03 | Генерация стратегий, оптимизация |
| Claude Opus | ~$0.15 | Сложный анализ, multi-step reasoning (редко) |

---

## 2. Возможности и ограничения для пользователя

### Матрица запросов: что возможно, а что нет

| Запрос юзера | Результат | Почему |
|---|---|---|
| "Momentum на BTC 4h с RSI и EMA" | ✅ Полный код стратегии | Все индикаторы есть в API |
| "BB squeeze + volume breakout на ETH" | ✅ Полный код | BB, ATR, volume — всё доступно |
| "Funding rate арбитраж с Kelly sizing" | ✅ Полный код | FR данные + Kelly sizing в API |
| "Mean reversion на Polymarket" | ❌ Нет real-time feed для paper trading — broken funnel | Нет real-time feed для paper trading |
| "Переведи Pine Script стратегию" | ✅ AI переведёт логику в наш TS API | LLM хорош в переводе кода |
| "Лонгуй DOGE на твитах Маска" | 🟡 Нет Twitter API. Используй volume spike как proxy | Нет внешних API в sandbox |
| "Стратегия на order book imbalance" | 🟡 Нет L2 данных. AI предложит volume-based альтернативу | Только OHLCV свечи |
| "ML модель LSTM для предсказания" | 🟡 Нет tensorflow в sandbox. Не планируется в MVP | Sandbox whitelist |
| "Торгуй ETH когда BTC пробивает 100k" | 🟡 Нет cross-asset | Один символ на стратегию |
| "4h тренд + 5m вход" | 🟡 Нет multi-TF. AI предложит single-TF компромисс | Один таймфрейм на стратегию |
| "HFT маркет-мейкинг с лимитками" | ❌ Нет лимитных ордеров в движке | Ограничение архитектуры |
| "Арбитраж между Binance и Bybit" | ❌ Один exchange на бэктест | Архитектурное ограничение |
| "Real-time social sentiment trading" | ❌ Нет real-time внешних feeds | Sandbox изоляция |

### Уровни сложности запросов

**🟢 ЛЕГКО (90% пользователей)** — всё работает из коробки:

Любая комбинация индикаторов (SMA, EMA, RSI, MACD, BB, ATR, ADX, CCI, Stochastic, TRIX) + любые stop-loss / take-profit / trailing stop + любой position sizing (fixed, volatility-adjusted, Kelly) + funding rates (futures) = тысячи возможных стратегий.

**🟡 СРЕДНЕ (8%)** — работает с workaround:

- Pine Script → "AI переведёт логику в наш TypeScript API"

**🔴 НЕ РАБОТАЕТ (2%)** — AI честно объясняет и предлагает альтернативу:

- HFT / order book strategies
- Real-time social feeds / news sentiment
- Multi-exchange арбитраж
- Limit / stop orders (только market orders)
- Multi-timeframe анализ (планируется)

### Почему НЕТ custom data upload в MVP

Custom data upload (загрузка CSV/JSON) выглядит привлекательно, но ломает цепочку ценности:

```
Бэктест на загруженных данных ✅ → Paper Trading ❌ → Live Bot ❌
```

Без real-time feed для paper trading пользователь получает бэктест в вакууме — фрустрация вместо ценности. Custom data upload имеет смысл только когда появятся коннекторы к новым биржам/источникам.

**Планируется**: после connector abstraction (post-MVP), как мост к новым биржам.

### Поведение AI-ассистента при ограничениях

AI-ассистент должен:
1. **Честно сообщить** что именно невозможно и почему
2. **Предложить альтернативу** (proxy через доступные данные, custom data upload)
3. **Никогда не генерировать нерабочий код** молча

---

## 3. Монетизация

### Модель: Free tier + Credit packs (гибрид)

| Tier | Цена | Credits/месяц | Per-Credit |
|------|-------|---------|------------|
| Free | $0 | 5 | — |
| Starter | $5 | 15 | $0.33 |
| Standard | $15 | 50 | $0.30 |
| Power | $40 | 150 | $0.27 |

Кредиты НЕ сгорают. Каждая AI-генерация = 1 кредит (базовая), 2 кредита (оптимизация), 3 кредита (full workflow с бэктестом).

#### Credit consumption model:

```typescript
// Types
enum CreditCost {
  BASIC_GENERATION = 1,        // config existing strategy
  WITH_BACKTEST = 2,           // config + quick backtest
  CODE_GENERATION = 3,         // generate new strategy code
  CODE_WITH_BACKTEST = 5,      // code gen + backtest
  WALK_FORWARD = 5,            // full robustness test
}

// Middleware
async function chargeCredits(userId, cost) {
  const ledger = await db.creditLedger.create({
    user_id: userId,
    amount: -cost,
    reason: "ai_generation",
    timestamp: now()
  });

  const balance = await db.users.update(userId, {
    credits_balance: db.raw("credits_balance - ?", [cost])
  });

  if (balance < 0) {
    throw new InsufficientCreditsError("Purchase more credits");
  }
}
```

### Почему именно кредиты:

- **Идеально для крипто-платежей** — одна транзакция, потом расходуешь
- **Нет проблемы recurring billing** в крипте (нет кредитных карт на анонимные кошельки)
- **Gas fees амортизируются** на много использований
- **Работает одинаково** для крипто и фиата
- **Просто отслеживать** — аудит-лог для налогов

### Unit economics:

```
Себестоимость 1 генерации (Sonnet):  $0.03
Продажа за кредит:                   $0.30 (10x markup)
Gross margin:                         ~90%

Revenue projections:
- 50 платящих пользователей × $15/мес = $750/мес
- 200 платящих × $15/мес = $3,000/мес
- 500 платящих × $20/мес (mix) = $10,000/мес
```

---

## 4. Платёжный шлюз

### Крипто: NOWPayments

- **Fees**: 0.5% (самые низкие в индустрии)
- **Поддержка**: USDC (Polygon, Base), USDT (Tron), BTC, ETH
- **Webhook-интеграция** с Fastify
- **Self-custody не нужен** на раннем этапе — NOWPayments как кастодиан

#### Предпочтительные сети:

| Сеть | Token | Финальность | Gas | Populярность |
|------|-------|-----------|-----|-------------|
| Polygon | USDC | 2s | <$0.01 | Растущая |
| Tron | USDT | 3s | ~$1 | Азия |
| Base | USDC | 2s | <$0.05 | L2 фокус |
| Solana | USDC | 13s | <$0.01 | Новички |

#### NOWPayments webhook:

```typescript
// src/api/routes/webhooks/nowpayments.ts
import { FastifyInstance } from "fastify";

export async function registerNowpaymentsWebhooks(app: FastifyInstance) {
  app.post<{ Body: NowpaymentsWebhook }>("/webhooks/nowpayments", async (request, reply) => {
    const { invoice_id, payment_status, amount_received, crypto } = request.body;

    // Verify signature
    const hash = crypto
      .createHmac("sha512", process.env.NOWPAYMENTS_IPN_KEY!)
      .update(JSON.stringify(request.body))
      .digest("hex");

    if (hash !== request.headers["x-nowpayments-sig"]) {
      return reply.status(401).send({ error: "Invalid signature" });
    }

    // Idempotent credit grant
    await db.transaction(async (trx) => {
      const existing = await trx("webhook_events")
        .where({ event_id: invoice_id, source: "nowpayments" })
        .first();

      if (existing) return; // Already processed

      if (payment_status === "finished") {
        const transaction = await trx("payment_transactions")
          .where({ nowpayments_invoice_id: invoice_id })
          .first();

        // Grant credits
        await trx("users").where({ id: transaction.user_id }).update({
          credits_balance: db.raw("credits_balance + ?", [transaction.credits])
        });

        // Log event
        await trx("webhook_events").insert({
          event_id: invoice_id,
          source: "nowpayments",
          status: "success",
          timestamp: new Date()
        });
      }
    });

    reply.send({ status: "ok" });
  });
}
```

### Фиат: Lemon Squeezy

- **Merchant of Record** — они сами разбираются с VAT/GST в каждой стране
- **Меньше риска** чем Stripe (Stripe может заморозить крипто-adjacent аккаунт)
- **Fees**: 5% + $0.50 per transaction
- **Простой overlay checkout** (встраиваемый iframe)

#### Lemon Squeezy product setup:

```json
{
  "name": "Credit Pack - Standard",
  "credits": 50,
  "price_usd": 15,
  "description": "50 AI generation credits",
  "type": "one-time",
  "variants": [
    { "name": "USD", "currency": "USD", "price": 15 },
    { "name": "EUR", "currency": "EUR", "price": 13 }
  ]
}
```

### Payment flow:

```
Пользователь выбирает credit pack
  ↓
Backend создаёт payment через NOWPayments/LS API
  ↓
Показываем QR-код (крипто) или checkout overlay (фиат)
  ↓
Webhook подтверждает оплату (NOWPayments) или
Lemon Squeezy redirect_url проходит verification
  ↓
Backend начисляет кредиты (атомарная DB-транзакция)
  ↓
Frontend обновляет баланс в реальном времени
```

### Database schema (новые таблицы):

```sql
-- Credit packs catalog
CREATE TABLE credit_packs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  credits INT,
  price_usd DECIMAL(10, 2),
  tier VARCHAR(50), -- 'free', 'starter', 'standard', 'power'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Payment transactions (state machine)
CREATE TABLE payment_transactions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  pack_id INT REFERENCES credit_packs(id),
  amount_usd DECIMAL(10, 2),
  credits INT,
  payment_method VARCHAR(50), -- 'nowpayments', 'lemon_squeezy'

  -- NOWPayments fields
  nowpayments_invoice_id VARCHAR(255) UNIQUE,
  nowpayments_payment_id VARCHAR(255),
  crypto_amount DECIMAL(20, 8),
  crypto_currency VARCHAR(20),

  -- Lemon Squeezy fields
  lemon_order_id VARCHAR(255) UNIQUE,
  lemon_order_number VARCHAR(255),

  -- State machine
  status VARCHAR(50) DEFAULT 'pending',
  -- pending -> confirming -> confirmed -> credited

  created_at TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP,
  credited_at TIMESTAMP,

  CONSTRAINT valid_status CHECK (status IN ('pending', 'confirming', 'confirmed', 'credited', 'failed'))
);

-- Credit ledger (immutable audit log)
CREATE TABLE credit_ledger (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  amount INT, -- positive for grant, negative for charge
  reason VARCHAR(100), -- 'ai_generation', 'backtest', 'monthly_grant', 'manual_refund'
  reference_id VARCHAR(255), -- ai_generation_id, backtest_run_id
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- AI generation tracking
CREATE TABLE ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  conversation_id UUID REFERENCES conversations(id),

  -- Prompt & response
  user_prompt TEXT,
  assistant_response TEXT,
  system_prompt_hash VARCHAR(64), -- To detect prompt changes

  -- Model details
  model VARCHAR(50), -- 'claude-sonnet', 'claude-haiku'
  tokens_input INT,
  tokens_output INT,
  cost_usd DECIMAL(10, 6),

  -- Generated config
  strategy_name VARCHAR(100),
  strategy_params JSONB,
  symbol VARCHAR(20),
  timeframe VARCHAR(10),

  -- Status
  status VARCHAR(50), -- 'success', 'validation_error', 'rate_limited'
  error_message TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_user_created (user_id, created_at DESC),
  INDEX idx_conversation (conversation_id)
);

-- Webhook events (for idempotency & debugging)
CREATE TABLE webhook_events (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(255), -- invoice_id / order_id
  source VARCHAR(50), -- 'nowpayments', 'lemon_squeezy'
  status VARCHAR(50), -- 'success', 'failed', 'retry'
  raw_payload JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  UNIQUE(event_id, source)
);

-- Update existing users table
ALTER TABLE users ADD COLUMN email VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN credits_balance INT DEFAULT 0;
ALTER TABLE users ADD COLUMN free_credits_remaining INT DEFAULT 5; -- Reset monthly
ALTER TABLE users ADD COLUMN tier VARCHAR(50) DEFAULT 'free';
ALTER TABLE users ADD COLUMN tier_expiry TIMESTAMP;
ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT NOW();
```

---

## 5. Frontend / UX

### Layout: Chat panel справа (resizable)

```
+--------------------+--------------------------+------------------+
|                    |                          |                  |
|  Strategy Config   |  Chart + Metrics +       |   AI Chat Panel  |
|  (left sidebar)    |  Trades Table            |   (right panel)  |
|                    |  (flex-1)                |   w-[400px]      |
|  w-96 fixed        |                          |   resizable      |
|                    |                          |                  |
+--------------------+--------------------------+------------------+
```

#### Состояния Chat Panel:

- **Collapsed**: Floating button в правом нижнем углу (с пульсирующей иконкой)
- **Expanded**: Правая панель w-[400px] с drag-resize boundary
- **Maximized**: 60% ширины для детальных диалогов (full conversation history)

### Типы сообщений в чате:

| Type | Описание | Пример |
|------|----------|--------|
| `text` | Markdown с объяснениями | "FundingRateCarry хороша когда..." |
| `strategy_card` | Интерактивная карточка стратегии | Card с параметрами и кнопкой "Apply" |
| `backtest_preview` | Compact metrics + sparkline | Sharpe 1.2, Return 45%, DD 8% |
| `action_button` | Кнопка для действия | "Run Backtest", "Start Paper Trading" |
| `comparison_table` | Сравнение нескольких стратегий | Side-by-side metrics |
| `error` | Ошибка (красный) | "Недостаточно кредитов" |

#### StrategyCardMessage component:

```typescript
// src/web/components/AiChat/StrategyCardMessage.tsx
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface StrategyCard {
  strategy_name: string;
  parameters: Record<string, number>;
  symbol: string;
  timeframe: string;
  explanation: string;
  estimated_sharpe?: number;
}

export function StrategyCardMessage({ card }: { card: StrategyCard }) {
  const { configStore } = useStores();

  const handleApply = () => {
    configStore.setStrategy({
      name: card.strategy_name,
      params: card.parameters,
      symbol: card.symbol,
      timeframe: card.timeframe
    });
    // Toast: "Applied to config"
  };

  const handleBacktest = async () => {
    // Trigger backtest immediately
    await configStore.runBacktest();
  };

  return (
    <Card className="bg-slate-800 border-sky-500/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sky-400">{card.strategy_name}</h3>
        <span className="text-xs text-gray-400">{card.symbol}</span>
      </div>

      <p className="text-sm text-gray-300">{card.explanation}</p>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {Object.entries(card.parameters).map(([key, value]) => (
          <div key={key} className="bg-slate-900 p-2 rounded">
            <div className="text-gray-400">{key}</div>
            <div className="text-sky-400 font-mono">{value}</div>
          </div>
        ))}
      </div>

      {card.estimated_sharpe && (
        <div className="bg-emerald-900/20 border border-emerald-500/30 p-2 rounded text-sm">
          Expected Sharpe: <span className="font-mono text-emerald-400">{card.estimated_sharpe.toFixed(2)}</span>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleApply}
          className="flex-1"
        >
          Apply to Config
        </Button>
        <Button
          size="sm"
          onClick={handleBacktest}
          className="flex-1 bg-sky-600 hover:bg-sky-700"
        >
          Run Backtest
        </Button>
      </div>
    </Card>
  );
}
```

### Ключевой паттерн: Synchronized Dual Panel

```
AI предлагает стратегию
  ↓ (пользователь нажимает "Apply to Config")
левый sidebar обновляется
  ↓ (пользователь может подкрутить руками)
пользователь нажимает "Run Backtest"
  ↓
результат в чате И на графике одновременно
  ↓
пользователь говорит "уменьши риск"
  ↓
AI обновляет параметры
```

### User Journey:

```
1. Новый пользователь видит floating button
   ↓ (пульсирующая иконка)

2. Открывает чат → welcome message + 4 clickable example prompts
   - "Funding rate strategy for BTC"
   - "Conservative momentum on EURUSD"
   - "Portfolio diversification"
   - "Show me all available strategies"

3. Выбирает/пишет prompt → AI стримит ответ с strategy card

4. Нажимает "Run Backtest" прямо из карточки

5. Видит результат в реальном времени (SSE + chart update)

6. Говорит "уменьши риск на 30%" → AI обновляет параметры

7. Запускает paper trading одним кликом

8. При исчерпании free tier → нативная промо на покупку credits

9. Видит price table → выбирает пакет → платит USDC на Polygon

10. Получает credits мгновенно → продолжает использование
```

### Tech stack:

| Компонент | Выбор | Причина |
|-----------|-------|--------|
| Стриминг | SSE | Уже используется в кодебазе, проще auth |
| State mgmt | Zustand | Consistent с `configStore`, `backtestStore` |
| Markdown | `react-markdown` + `remark-gfm` | Tables, code blocks, emphasis |
| Styling | Tailwind dark theme | gray-900/800/700 + sky-blue accent |
| Keyboard | Cmd+K toggle, Enter send | Standard для chat UIs |
| Icons | Existing icon set | speech-bubble, send, close |

#### chatStore.ts:

```typescript
// src/web/stores/chatStore.ts
import { create } from "zustand";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  type: "text" | "strategy_card" | "backtest_preview" | "action_button" | "comparison_table" | "error";
  data?: StrategyCard | BacktestPreview;
  createdAt: Date;
}

interface ChatStore {
  conversationId: string | null;
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  creditsBalance: number;

  // Actions
  startConversation: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  streamMessage: (stream: ReadableStream) => Promise<void>;
  clearChat: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  conversationId: null,
  messages: [],
  isLoading: false,
  error: null,
  creditsBalance: 0,

  startConversation: async () => {
    const res = await fetch("/api/ai/conversations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${getToken()}` }
    });
    const { id } = await res.json();
    set({ conversationId: id, messages: [] });
  },

  sendMessage: async (text) => {
    set({ isLoading: true, error: null });

    const convId = get().conversationId!;
    set(state => ({
      messages: [...state.messages, {
        id: nanoid(),
        role: "user",
        content: text,
        type: "text",
        createdAt: new Date()
      }]
    }));

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${getToken()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ conversation_id: convId, message: text })
      });

      if (!response.ok) {
        if (response.status === 402) {
          set({ error: "Insufficient credits. Purchase more?" });
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      await get().streamMessage(response.body!);
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  streamMessage: async (stream) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentMessage: Message = {
      id: nanoid(),
      role: "assistant",
      content: "",
      type: "text",
      createdAt: new Date()
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        const json = JSON.parse(line.slice(6));

        if (json.type === "content") {
          currentMessage.content += json.content;
        } else if (json.type === "tool_use") {
          currentMessage = {
            ...currentMessage,
            type: "strategy_card",
            data: json.strategy_card
          };
        } else if (json.type === "done") {
          set(state => ({
            messages: [...state.messages, currentMessage],
            creditsBalance: json.credits_balance
          }));
        }
      }
    }
  },

  clearChat: () => set({ messages: [], conversationId: null })
}));
```

#### AIChatPanel.tsx:

```typescript
// src/web/components/AiChat/AIChatPanel.tsx
import { useRef, useEffect, useState } from "react";
import { useChatStore } from "@/web/stores/chatStore";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { Button } from "@/components/ui/button";

export function AIChatPanel() {
  const chatStore = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatStore.messages]);

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="fixed bottom-6 right-6 w-12 h-12 bg-sky-600 rounded-full shadow-lg hover:bg-sky-700 animate-pulse"
      >
        <span>💬</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 w-[400px] h-[600px] bg-slate-900 border-l border-sky-500/20 rounded-tl-lg shadow-2xl flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-sky-500/20">
        <h2 className="font-semibold text-sky-400">Strategy Assistant</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(false)}
        >
          ×
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chatStore.messages.length === 0 ? (
          <div className="text-center text-gray-400 pt-8">
            <p className="mb-4">Hi! I'm your strategy assistant.</p>
            <p className="text-sm mb-4">Try asking about:</p>
            <div className="space-y-2">
              {[
                "Funding rate strategy for BTC",
                "Conservative momentum",
                "Show available strategies"
              ].map(prompt => (
                <Button
                  key={prompt}
                  variant="outline"
                  size="sm"
                  onClick={() => chatStore.sendMessage(prompt)}
                  className="w-full text-xs"
                >
                  {prompt}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {chatStore.messages.map(msg => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <ChatInput onSend={chatStore.sendMessage} isLoading={chatStore.isLoading} />

      {/* Error */}
      {chatStore.error && (
        <div className="px-4 py-2 bg-red-900/20 text-red-400 text-sm border-t border-red-500/20">
          {chatStore.error}
        </div>
      )}

      {/* Credits */}
      <div className="px-4 py-2 bg-slate-800 text-xs text-gray-400 flex justify-between border-t border-sky-500/10">
        <span>Credits: {chatStore.creditsBalance}</span>
        <a href="/account/credits" className="text-sky-400 hover:underline">
          Buy
        </a>
      </div>
    </div>
  );
}
```

---

## 6. Безопасность и инфраструктура

### Критические проблемы ПЕРЕД запуском (P0)

| Проблема | Решение | Effort | Priority |
|----------|---------|--------|----------|
| Нет HTTPS — JWT в открытом тексте | Cloudflare proxy (бесплатный) или Let's Encrypt | 1 час | P0 |
| Нет data isolation — юзеры видят чужие данные | WHERE user_id = $current в всех запросах | 1 день | P0 |
| JWT_SECRET с fallback на hardcoded | Crash on startup if default in production | 30 мин | P0 |
| CORS origin: true | Ограничить до реального домена | 30 мин | P0 |
| Нет rate limiting | @fastify/rate-limit + Redis | 1 день | P0 |
| Нет email verification | Sendgrid/Mailgun + token verification | 1 день | P1 |

#### Audit middleware:

```typescript
// src/api/middleware/audit.ts
export async function auditMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const userId = request.user?.id;
  const startTime = performance.now();

  reply.on("send", (payload) => {
    const duration = performance.now() - startTime;
    logger.info({
      timestamp: new Date(),
      userId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration: duration.toFixed(2) + "ms",
      ip: request.ip
    });
  });
}

// src/api/middleware/dataIsolation.ts
export async function dataIsolationMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Prevent accidental data exposure
  if (request.method !== "GET" && request.url.includes("/api/")) {
    const userId = request.user?.id;
    if (!userId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  }
}
```

#### JWT validation:

```typescript
// src/api/utils/jwt.ts
export async function verifyJWT(token: string): Promise<JWTPayload> {
  if (!process.env.JWT_SECRET) {
    throw new Error("FATAL: JWT_SECRET not set in environment");
  }

  // Prevent default 'secret' in production
  if (process.env.JWT_SECRET === "secret" && process.env.NODE_ENV === "production") {
    throw new Error("FATAL: Using default JWT_SECRET in production");
  }

  return jwt.verify(token, process.env.JWT_SECRET) as JWTPayload;
}
```

### Rate limiting:

```typescript
// src/api/plugins/rateLimit.ts
import rateLimit from "@fastify/rate-limit";

export async function registerRateLimitPlugin(app: FastifyInstance) {
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "15 minutes",
    cache: 10000,
    allowList: ["127.0.0.1"],
    redis: redis, // Shared Redis instance

    // Per-route limits
    skipOnError: false,
  });

  // AI endpoints: stricter limits
  app.register(rateLimit, {
    max: 10,
    timeWindow: "1 hour",
    cache: 10000,
  }, { prefix: "/api/ai" });
}
```

### Infrastructure scaling path:

#### Phase 1 (10-100 users):
```
Текущий VPS ($12/мес)
+ Redis контейнер (в Docker, бесплатно)
+ BullMQ для job queue
+ Worker process (тот же VPS)

Cost: ~$15/мес (текущие расходы)
```

#### Phase 2 (100-500 users):
```
API VPS ($12/мес)
+ Worker VPS ($6/мес)
+ Redis managed ($5/мес)
+ Cloudflare CDN (бесплатный)
+ PgBouncer для connection pooling ($0)

Cost: ~$35/мес
Capacity: 500 concurrent users, 50 backtest jobs/sec
```

#### Phase 3 (500+ users):
```
API cluster (3x $12 = $36/мес)
+ Worker cluster (5x $6 = $30/мес)
+ Managed PostgreSQL ($25/мес)
+ Redis managed ($10/мес)
+ Load balancer ($5/мес)
+ Monitoring (DataDog $15/мес)

Cost: ~$120/мес
Capacity: 5000 concurrent users, 200 backtest jobs/sec
Reliability: 99.9% uptime SLA
```

#### Database scaling:

```typescript
// src/data/db.ts
import { Pool } from "pg";

// Phase 1: Single connection
const db = new Client({ connectionString: process.env.DATABASE_URL });

// Phase 2: Connection pool with PgBouncer
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Phase 3: Read replicas
const readPool = new Pool({
  connectionString: process.env.DATABASE_READ_REPLICA_URL,
  max: 50
});

// Route read-heavy queries to replica
export async function queryRead(sql: string, params: any[]) {
  if (process.env.USE_READ_REPLICAS === "true") {
    return readPool.query(sql, params);
  }
  return pool.query(sql, params);
}
```

### Sandbox для будущей генерации кода (Phase 2):

#### isolated-vm approach:

```typescript
// src/ai/sandbox/isolate.ts
import { Isolate, Context } from "isolated-vm";

export async function executeUserCode(code: string, config: BacktestConfig) {
  const isolate = new Isolate({ memoryLimit: 128 }); // 128MB per isolate

  try {
    const context = await isolate.createContext();

    // Setup whitelisted API
    const jail = context.global;
    await jail.set("ctx", {
      candles: config.candles,
      openLong: async (size: number) => { /* ... */ },
      closeLong: () => { /* ... */ },
      getLongSize: () => { /* ... */ },
      equity: config.initialCapital
    });

    // Compile and validate with TypeScript AST
    const validated = await validateUserCode(code);

    // Execute with timeout
    const result = await isolate.run(validated, {
      timeout: 5000 // 5 second max per symbol
    });

    return result;
  } finally {
    isolate.dispose();
  }
}

async function validateUserCode(code: string) {
  // Parse TypeScript AST
  const ast = parse(code);

  // Whitelist analysis: only allow ctx.* and Math.*
  const forbidden = ["require", "import", "eval", "fetch", "process"];
  for (const node of ast.body) {
    if (isCallExpression(node) && isForbidden(node.callee)) {
      throw new Error(`Forbidden function: ${node.callee.name}`);
    }
  }

  return code;
}
```

#### Worker thread wrapper:

```typescript
// src/ai/sandbox/worker.ts
import { Worker } from "worker_threads";
import path from "path";

export class SandboxWorker {
  private worker: Worker;
  private resultPromises = new Map();

  constructor() {
    this.worker = new Worker(path.join(__dirname, "isolate-worker.js"));
    this.worker.on("message", (msg) => {
      const resolve = this.resultPromises.get(msg.id);
      if (resolve) {
        resolve(msg.result);
        this.resultPromises.delete(msg.id);
      }
    });
  }

  async execute(code: string, config: BacktestConfig) {
    const id = nanoid();

    return new Promise((resolve, reject) => {
      this.resultPromises.set(id, resolve);

      const timeout = setTimeout(() => {
        this.resultPromises.delete(id);
        reject(new Error("Sandbox execution timeout"));
      }, 6000); // 5s execution + 1s buffer

      this.worker.postMessage({ id, code, config });
    });
  }
}

// src/ai/sandbox/isolate-worker.ts
import { parentPort } from "worker_threads";
import { executeUserCode } from "./isolate";

parentPort!.on("message", async (msg) => {
  try {
    const result = await executeUserCode(msg.code, msg.config);
    parentPort!.postMessage({ id: msg.id, result, error: null });
  } catch (error) {
    parentPort!.postMessage({
      id: msg.id,
      result: null,
      error: error.message
    });
  }
});
```

---

## 7. Legal / Compliance

### Обязательно до запуска:

#### 1. Disclaimer (в UI и email):

```
⚠️ DISCLAIMER
This AI strategy assistant is for INFORMATIONAL AND EDUCATIONAL PURPOSES ONLY.
It does not constitute financial advice, investment recommendation, or offer to buy/sell.

Past performance is not indicative of future results. Cryptocurrency trading
involves substantial risk of loss, including loss of principal.

By using this platform, you acknowledge that you have read and understood the risks.
```

#### 2. Terms of Service (на /legal/tos):

- No financial advice, no investment recommendation
- User is responsible for their own trading decisions
- Platform liability capped at amount paid in last 12 months
- AI-generated strategies are suggestions only
- Intellectual property: user retains ownership of prompts, platform owns strategies
- Termination: platform can terminate account for TOS violation
- Dispute resolution: arbitration, not litigation
- Credit packs: non-refundable (except per jurisdiction law)

#### 3. Privacy Policy (на /legal/privacy):

- Data collection: prompts, backtest results, trading history, email, payment info
- Data retention: 90 days for free users, unlimited for paid
- Data deletion: GDPR right to erasure (export endpoint, deletion endpoint)
- Cookies: session JWT, analytics (Plausible, privacy-respecting)
- Third-party processors: Anthropic (Claude API), NOWPayments, Lemon Squeezy
- DPO email: privacy@platform.example.com (if GDPR applies)

#### 4. GDPR compliance (if EU users):

```typescript
// src/api/routes/account/export.ts
app.get("/account/export", async (request: FastifyRequest, reply: FastifyReply) => {
  const userId = request.user!.id;

  const data = await db.transaction(async (trx) => {
    const user = await trx("users").where({ id: userId }).first();
    const backtests = await trx("backtest_runs").where({ user_id: userId });
    const aiGenerations = await trx("ai_generations").where({ user_id: userId });
    const payments = await trx("payment_transactions").where({ user_id: userId });

    return { user, backtests, aiGenerations, payments };
  });

  reply.type("application/json").send(JSON.stringify(data, null, 2));
});

// src/api/routes/account/delete.ts
app.delete("/account/delete", async (request: FastifyRequest, reply: FastifyReply) => {
  const userId = request.user!.id;

  // Soft delete: preserve audit logs for 90 days
  await db.transaction(async (trx) => {
    await trx("users").where({ id: userId }).update({
      deleted_at: new Date(),
      email: null,
      password: null
    });

    // Hard delete after 90 days (scheduled job)
  });

  reply.send({ status: "Account marked for deletion" });
});
```

### Налоги:

#### NOWPayments:

- Enable auto-conversion to fiat (e.g., daily settlement to EUR bank account)
- Keeps crypto tax accounting simple: receive USDC, immediately convert to EUR
- Tax report: one line per transaction (date, amount, crypto/fiat, to bank)

#### Lemon Squeezy:

- Merchant of Record — они сами платят VAT/GST в каждой стране
- Нам не нужно разбираться с tax compliance в 50+ юрисдикциях
- Берём фиат из Lemon Squeezy → идёт в чистый доход (за вычетом их комиссии)

#### Accounting:

```
Monthly:
  Revenue = (NOWPayments settled USD) + (Lemon Squeezy payouts)
  COGS = (API calls × $0.03 per call)
  Gross Profit = Revenue - COGS
  Operating Expenses = server + domain + monitoring
  Net Income = Gross Profit - Expenses

Quarterly:
  File corporate tax return (jurisdiction-specific)
  VAT/GST: NOWPayments and Lemon Squeezy handle this
  Crypto gains/losses: track if we hold crypto (we don't initially)
```

---

## 8. Роадмап имплементации

### Timeline: 8-12 недель до MVP launch

```
Week 1-2: Foundation (P0 Security)
├─ [ ] HTTPS setup (Cloudflare or Let's Encrypt)
├─ [ ] Data isolation audit (all queries + user_id WHERE)
├─ [ ] JWT validation hardening
├─ [ ] CORS restriction
├─ [ ] Rate limiting (@fastify/rate-limit + Redis)
└─ Risk: HIGH — cannot launch without these

Week 2-3: User Management & Database
├─ [ ] User registration flow (email signup, verification)
├─ [ ] Email verification (Sendgrid integration)
├─ [ ] Password reset flow
├─ [ ] DB migrations (credits, payments, ledger, ai_generations tables)
├─ [ ] Auth tests (unit + integration)
└─ [ ] Add to existing user table: email, credits_balance, tier

Week 3-4: AI Backend Core
├─ [ ] Claude API integration (claude-sonnet-4-20250514)
├─ [ ] Tool use schema for select_strategy()
├─ [ ] System prompt generation (auto from /strategies/)
├─ [ ] POST /api/ai/chat endpoint (streaming SSE)
├─ [ ] Zod validation for generated configs
├─ [ ] Credit deduction middleware
├─ [ ] ai_generations table logging
└─ [ ] Integration tests with real Claude API

Week 4-5: Chat Frontend
├─ [ ] chatStore.ts (Zustand)
├─ [ ] AIChatPanel component (right panel, resizable)
├─ [ ] ChatMessage, StrategyCardMessage, BacktestPreviewMessage
├─ [ ] ChatInput with example prompts
├─ [ ] SSE streaming integration
├─ [ ] Synchronized dual panel (config + chat)
└─ [ ] Mobile responsive overlay

Week 5-6: Payments Infrastructure
├─ [ ] NOWPayments API integration (payment creation, webhook)
├─ [ ] Lemon Squeezy integration (checkout iframe, webhook)
├─ [ ] payment_transactions state machine
├─ [ ] Idempotent credit grant via webhooks
├─ [ ] Payment history page
├─ [ ] Credit pack purchasing UI
└─ [ ] Webhook signature verification tests

Week 6-7: Backtest Integration
├─ [ ] One-click backtest from chat
├─ [ ] backtest_preview message type
├─ [ ] Real-time equity curve update in chart
├─ [ ] Comparison table for multiple strategies
└─ [ ] Paper trading trigger from chat

Week 7-8: Polish & Admin
├─ [ ] Usage dashboard (admin: credits/user, API costs)
├─ [ ] Onboarding flow (welcome email + in-app tour)
├─ [ ] Conversation history persistence
├─ [ ] Strategy templates gallery (zero AI cost)
├─ [ ] Keyboard shortcuts (Cmd+K, Enter, Shift+Enter)
├─ [ ] Landing page updates
└─ [ ] Legal docs (TOS, Privacy, Disclaimer)

Week 7-8: Code Generation
├─ [ ] Code generation pipeline (tsc → AST check → isolated-vm)
├─ [ ] Code editor in chat (Monaco/CodeMirror)
├─ [ ] Save/load user strategies to DB
└─ [ ] Smoke test runner (dry run on 10 candles)

Week 8-9: QA & Security Audit
├─ [ ] Security audit (SQL injection, XSS, CSRF)
├─ [ ] Load testing (100 concurrent users, 10 AI requests/sec)
├─ [ ] Payment flow end-to-end testing (sandbox NOWPayments)
├─ [ ] GDPR readiness (export, deletion endpoints)
└─ [ ] Stress test AI generation with rate limiting

Week 9-10: Monitoring & Deployment
├─ [ ] Error tracking (Sentry or custom)
├─ [ ] Request logging & audit trails
├─ [ ] Basic monitoring (UptimeRobot, Telegram alerts)
├─ [ ] Deployment checklist (env vars, backups, rollback plan)
└─ [ ] Dry run deployment to production

Week 10-11: Soft Launch
├─ [ ] Beta access (50-100 users)
├─ [ ] Feedback loop (Discord, email survey)
├─ [ ] Fix critical issues (P0/P1)
├─ [ ] Monitor API costs vs revenue
└─ [ ] Refine pricing if needed

Week 11-12: Public Launch
├─ [ ] Marketing (Twitter, Reddit, HN)
├─ [ ] Public landing page
├─ [ ] Social proof (testimonials, comparison videos)
├─ [ ] Help docs (FAQ, video tutorials)
└─ [ ] Post-launch support (daily check-ins)
```

### Detailed sprint breakdown:

#### Sprint 1: Foundation (P0 Security) — Week 1-2

```typescript
// src/api/middleware/securityHeaders.ts
export async function securityHeadersMiddleware(app: FastifyInstance) {
  app.addHook("onSend", async (request, reply) => {
    // HTTPS redirect
    if (request.protocol === "http" && process.env.NODE_ENV === "production") {
      reply.redirect(`https://${request.hostname}${request.url}`);
      return;
    }

    // Security headers
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "1; mode=block");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  });
}
```

**Deliverables**:
- ✓ HTTPS enforced (redirect or Cloudflare proxy)
- ✓ All queries have user_id filter
- ✓ JWT_SECRET validation on startup
- ✓ CORS limited to single domain
- ✓ Rate limiting middleware

#### Sprint 2: User Management — Week 2-3

```sql
-- Migration: 001_create_auth_tables.sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMP,

  credits_balance INT DEFAULT 0,
  free_credits_remaining INT DEFAULT 5,
  tier VARCHAR(50) DEFAULT 'free',

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,

  INDEX idx_email (email)
);

CREATE TABLE email_verification_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Deliverables**:
- ✓ POST /api/auth/signup endpoint
- ✓ Email verification flow
- ✓ POST /api/auth/login endpoint
- ✓ JWT token generation
- ✓ Password reset flow
- ✓ Integration tests for auth

#### Sprint 3: AI Backend Core — Week 3-4

```typescript
// src/ai/claude.ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function generateStrategy(
  userPrompt: string,
  conversationHistory: ConversationMessage[]
) {
  // Build system prompt from all strategies
  const systemPrompt = buildSystemPromptFromStrategies();

  const messages = [
    ...conversationHistory,
    { role: "user", content: userPrompt }
  ];

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    tools: [
      {
        name: "select_strategy",
        description: "Generate a strategy configuration based on user requirements",
        input_schema: {
          type: "object",
          properties: {
            strategy_name: {
              type: "string",
              enum: Object.keys(strategyRegistry),
              description: "Name of the strategy from available catalog"
            },
            parameters: {
              type: "object",
              description: "Strategy parameters, validated against schema"
            },
            symbol: {
              type: "string",
              pattern: "^[A-Z]{1,5}/[A-Z]{3,4}$",
              description: "Trading pair (e.g., BTC/USDT)"
            },
            timeframe: {
              type: "string",
              enum: ["5m", "15m", "1h", "4h", "1d"],
              description: "Backtest timeframe"
            },
            explanation: {
              type: "string",
              description: "Brief explanation of why this strategy was chosen"
            }
          },
          required: ["strategy_name", "parameters", "symbol", "timeframe", "explanation"]
        }
      }
    ],
    messages
  });

  return response;
}

// src/api/routes/ai/chat.ts
app.post("/api/ai/chat", async (request: FastifyRequest, reply: FastifyReply) => {
  const userId = request.user!.id;
  const { conversation_id, message } = request.body as {
    conversation_id: string;
    message: string;
  };

  // Check credits
  const user = await db.query("SELECT credits_balance FROM users WHERE id = $1", [userId]);
  if (user.rows[0].credits_balance <= 0 && user.rows[0].free_credits_remaining <= 0) {
    return reply.status(402).send({ error: "Insufficient credits" });
  }

  // Fetch conversation history
  const history = await db.query(
    "SELECT role, content FROM ai_generations WHERE conversation_id = $1 ORDER BY created_at ASC",
    [conversation_id]
  );

  // Stream response
  reply.header("Content-Type", "text/event-stream");
  reply.header("Cache-Control", "no-cache");

  const messages: ConversationMessage[] = history.rows.map(row => ({
    role: row.role as "user" | "assistant",
    content: row.content
  }));

  try {
    const response = await generateStrategy(message, messages);

    let toolResult = null;
    for (const block of response.content) {
      if (block.type === "text") {
        reply.raw.write(`data: ${JSON.stringify({
          type: "content",
          content: block.text
        })}\n\n`);
      } else if (block.type === "tool_use") {
        // Validate tool input
        const validated = validateStrategyConfig(block.input);
        toolResult = {
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ success: true, config: validated })
        };

        reply.raw.write(`data: ${JSON.stringify({
          type: "tool_use",
          strategy_card: validated
        })}\n\n`);
      }
    }

    // Deduct credits
    await db.query(
      "UPDATE users SET credits_balance = credits_balance - 1 WHERE id = $1",
      [userId]
    );

    // Log generation
    await db.query(
      `INSERT INTO ai_generations
       (user_id, conversation_id, user_prompt, assistant_response,
        strategy_name, strategy_params, symbol, timeframe)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        conversation_id,
        message,
        JSON.stringify(response.content),
        toolResult?.input?.strategy_name,
        toolResult?.input?.parameters,
        toolResult?.input?.symbol,
        toolResult?.input?.timeframe
      ]
    );

    reply.raw.write(`data: ${JSON.stringify({
      type: "done",
      credits_balance: user.rows[0].credits_balance - 1
    })}\n\n`);

    reply.raw.end();
  } catch (error) {
    logger.error("AI generation error", error);
    reply.raw.write(`data: ${JSON.stringify({
      type: "error",
      message: error.message
    })}\n\n`);
    reply.raw.end();
  }
});
```

**Deliverables**:
- ✓ Claude API integration with tool_use
- ✓ POST /api/ai/chat endpoint (streaming SSE)
- ✓ Strategy config validation (Zod)
- ✓ ai_generations table logging
- ✓ Credit deduction middleware

#### Sprint 4: Chat Frontend — Week 4-5

**Deliverables**:
- ✓ chatStore.ts (Zustand state management)
- ✓ AIChatPanel component (resizable right panel)
- ✓ ChatMessage, StrategyCardMessage components
- ✓ ChatInput with example prompts
- ✓ SSE streaming integration
- ✓ Keyboard shortcuts (Cmd+K toggle, Enter send)

#### Sprint 5: Payments — Week 5-6

```typescript
// src/api/plugins/payments/nowpayments.ts
import axios from "axios";

const nowpayments = axios.create({
  baseURL: "https://api.nowpayments.io/v1",
  headers: {
    "x-api-key": process.env.NOWPAYMENTS_API_KEY
  }
});

export async function createPayment(
  amount: number,
  currency: "usd" = "usd",
  orderId: string
) {
  const response = await nowpayments.post("/invoice", {
    price_amount: amount,
    price_currency: currency,
    order_id: orderId,
    order_description: "AI Strategy Credits",
    ipn_callback_url: `${process.env.API_URL}/webhooks/nowpayments`,
    success_url: `${process.env.WEB_URL}/account/credits?status=success`,
    cancel_url: `${process.env.WEB_URL}/account/credits?status=cancelled`
  });

  return response.data; // { id, invoice_url, ... }
}

// src/api/routes/webhooks/nowpayments.ts
app.post("/webhooks/nowpayments", async (request, reply) => {
  const signature = request.headers["x-nowpayments-sig"];

  // Verify signature
  const hash = crypto
    .createHmac("sha512", process.env.NOWPAYMENTS_IPN_KEY!)
    .update(JSON.stringify(request.body))
    .digest("hex");

  if (hash !== signature) {
    return reply.status(401).send({ error: "Invalid signature" });
  }

  const { invoice_id, payment_status, amount_received } = request.body;

  // Idempotent processing
  const existing = await db.query(
    "SELECT * FROM webhook_events WHERE event_id = $1 AND source = 'nowpayments'",
    [invoice_id]
  );

  if (existing.rows.length > 0) {
    return reply.send({ status: "already_processed" });
  }

  if (payment_status === "finished") {
    await db.transaction(async (client) => {
      // Get transaction
      const trans = await client.query(
        "SELECT * FROM payment_transactions WHERE nowpayments_invoice_id = $1",
        [invoice_id]
      );

      if (trans.rows.length === 0) {
        throw new Error("Transaction not found");
      }

      const { user_id, credits } = trans.rows[0];

      // Grant credits
      await client.query(
        "UPDATE users SET credits_balance = credits_balance + $1 WHERE id = $2",
        [credits, user_id]
      );

      // Update transaction status
      await client.query(
        "UPDATE payment_transactions SET status = 'credited', credited_at = NOW() WHERE nowpayments_invoice_id = $1",
        [invoice_id]
      );

      // Log event
      await client.query(
        `INSERT INTO webhook_events (event_id, source, status, raw_payload)
         VALUES ($1, 'nowpayments', 'success', $2)`,
        [invoice_id, JSON.stringify(request.body)]
      );
    });
  }

  reply.send({ status: "ok" });
});
```

**Deliverables**:
- ✓ NOWPayments API integration
- ✓ Lemon Squeezy integration
- ✓ payment_transactions state machine
- ✓ Webhook handlers (verified + idempotent)
- ✓ Payment history page
- ✓ Credit pack purchasing UI

#### Sprint 6-12: Remaining features

Sprint 6: Backtest integration
Sprint 7: Polish
Sprint 8: QA
Sprint 9: Monitoring
Sprint 10-11: Soft launch
Sprint 12: Public launch

---

## 9. Ключевые архитектурные решения

### Decision Matrix

| Решение | Выбор | Альтернатива | Причина |
|---------|-------|-------------|--------|
| **AI подход** | Двухуровневый (config + code gen) | Только config | Полная гибкость для пользователя |
| **LLM стратегия** | API first → self-hosted при масштабе | Self-hosted сразу | API дешевле до 5000 gen/мес |
| **Custom data** | Отложено до post-MVP | CSV/JSON upload | Broken funnel без real-time feed |
| **LLM model** | Claude Sonnet | GPT-4o, Gemini 2.0 | Лучший tool_use, наш стек, дешевле |
| **Monetization** | Free tier + credit packs | Subscription | Работает с крипто, нет recurring billing |
| **Crypto payments** | NOWPayments | BTCPay, Coinbase Commerce | 0.5% fee (самые низкие), simple API |
| **Fiat payments** | Lemon Squeezy | Stripe, Paddle | MoR (налоги за них), crypto-friendly |
| **Streaming** | SSE | WebSocket | Уже в кодебазе, проще auth, HTTP/2 friendly |
| **Chat layout** | Right panel (40%) | Floating widget | Видно чат и график одновременно |
| **Sandbox** | isolated-vm | Docker per exec | 1ms startup vs 500ms, lower overhead |
| **Job queue** | BullMQ + Redis | In-process queue | Не блокирует API при тяжёлых бэктестах |
| **State mgmt** | Zustand | React Context | Consistent с configStore |
| **Database** | PostgreSQL (existing) | MongoDB, Supabase | Уже используется, ACID transactions критичны |
| **Email** | Sendgrid | Mailgun, AWS SES | Reliable, good templates, affordable |
| **Monitoring** | Sentry + UptimeRobot | Datadog, New Relic | Tight budget, Sentry free tier достаточен |
| **Auth** | JWT (existing) | OAuth2, Magic links | Уже в кодебазе, simple |

### Trade-offs:

1. **Двухуровневый AI-подход (config + code gen)**
   - Плюс: Level 1 дёшево и безопасно для 80% запросов; Level 2 даёт полную гибкость
   - Минус: сложнее pipeline (tsc → AST → isolated-vm), нужен sandbox
   - Решение: isolated-vm с AST validation обеспечивает безопасность; оба уровня запускаются через единый endpoint

2. **Credit packs (не subscription)**
   - Плюс: работает с крипто, нет проблемы recurring
   - Минус: нужно мотивировать покупку новых пакетов
   - Решение: gamification (badges, streak), social features

3. **SSE (не WebSocket)**
   - Плюс: уже в кодебазе, проще auth, HTTP/2 friendly
   - Минус: unidirectional только
   - Решение: достаточно для chat (пользователь → сервер → браузер)

4. **Isolated-vm (Phase 2, не Docker)**
   - Плюс: 1ms startup, hard limits, zero API access
   - Минус: требует V8 internals knowledge
   - Решение: есть готовые примеры, хорошо документировано

---

## 10. Success Metrics & KPIs

### Phase 1 (MVP Launch):

```
Baseline (month 1):
  - 100+ signups
  - 20+ active users
  - 50+ AI generations
  - 0 paid users (soft launch)
  - API availability: 99%

Target (month 2):
  - 500+ signups
  - 50+ active users
  - 200+ AI generations
  - 5+ paid users
  - $25 MRR
  - Credit utilization: 30% of free tier used
```

### Phase 2 (Iteration):

```
Target (month 3-4):
  - 2000+ signups
  - 200+ active users
  - 1000+ generations
  - 50+ paid users
  - $500 MRR
  - Churn rate: <20% monthly
  - Average session duration: 10 min
```

### Retention cohort:

Track cohort retention (sign up date → % still active in month 2, 3, 4):
- Goal: 50% month 1 → month 2 retention
- Goal: 30% month 2 → month 3 retention

### Feature adoption:

- Chat usage: % of active users who opened chat
- One-click backtest: % of strategy cards where user clicked "Run Backtest"
- Paper trading: % of successful backtests → paper trading conversion

---

## 11. Risks & Mitigation

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|-----------|
| Claude API rate limits | High | Medium | Implement exponential backoff, queue system |
| Payment webhook failures | Medium | High | Idempotent design, manual retry panel for admins |
| Database data isolation leak | Low | CRITICAL | Code review + automated tests + audit log |
| Sandbox escape (Phase 2) | Low | CRITICAL | Security audit by professional firm |
| GPU/CPU overload backtest | Medium | Medium | Job queue, worker pool auto-scaling |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|-----------|
| Low initial adoption | High | Medium | Community outreach (Reddit, Discord, Twitter) |
| Competitor launches similar | High | Medium | Build community first, exclusive features |
| Regulation (financial advice) | Medium | High | Strict disclaimers, legal review, no personalization |
| Payment processor blocks account | Low | CRITICAL | Diversify (NOWPayments + Lemon Squeezy) |

### Financial Risks

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|-----------|
| API costs exceed revenue | Medium | Medium | Monitor costs hourly, set daily budget limit |
| Chargebacks (crypto unclear) | Low | Medium | Detailed docs, video tutorials, refund policy |
| Tax issues (crypto + global) | Medium | Medium | Hire accountant (crypto-native), file properly |

---

## 12. Future Roadmap (Post-MVP)

### Q2 2026: Iteration & Scale

- [ ] Multiply strategy library (20+ strategies)
- [ ] Custom code generation (Phase 2 sandbox)
- [ ] Walk-forward validation in chat ("Is this robust?")
- [ ] Multi-asset portfolio builder
- [ ] Paper trading dashboard (PnL, fills, slippage)
- [ ] Real trading (paper → live with manual approval)

### Q3 2026: Community

- [ ] Strategy marketplace (share configs, earn bounty)
- [ ] Leaderboard (best strategies by Sharpe, returns)
- [ ] Social trading (follow expert traders)
- [ ] Telegram bot (trade alerts, quick commands)

### Q4 2026: Enterprise

- [ ] API access for programmatic backtest
- [ ] White-label solution (embed into other platforms)
- [ ] Advanced metrics (Monte Carlo, regime analysis)
- [ ] Institutional pricing (flat fee for unlimited)

---

## 13. Go-to-Market Strategy

### Pre-launch (Month 0):

- [ ] Build landing page
- [ ] Create demo video (user flow)
- [ ] Write 5 blog posts (SEO: "best crypto strategies", "AI backtesting")
- [ ] Reach out to 20 crypto Twitter influencers (free credits)

### Launch (Month 1):

- [ ] Post on Product Hunt
- [ ] Post on HackerNews
- [ ] Reddit communities: r/algotrading, r/cryptocurrency, r/crypto
- [ ] Share in relevant Discord/Telegram communities
- [ ] Email list from product-hunt signups

### Growth (Month 2-3):

- [ ] Affiliate program (20% commission per paid signup)
- [ ] Ads on crypto podcasts
- [ ] Content marketing (blog → Twitter → LinkedIn)
- [ ] Referral bonus (100 credits for successful referral)

---

## Заключение

Это мастер-план трансформирует backtesting-платформу в SaaS-продукт с AI-ассистентом за 8-12 недель. Ключевые преимущества:

1. **Быстрая разработка** — конфигурация существующих стратегий, не генерация кода
2. **Низкая себестоимость** — Claude Sonnet ~$0.03/генерацию, 10x markup → 90% margin
3. **Крипто-первый** — NOWPayments + Lemon Squeezy, работает для всех юрисдикций
4. **Безопасность** — P0 security checklist перед запуском
5. **Масштабируемость** — стартуем с одного VPS, растём линейно

Архитектура проверена четырьмя независимыми архитекторами:
- AI/Backend: Claude tool_use pipeline
- Payments: гибридная монетизация
- Frontend/UX: синхронизированная двухпанельная UX
- Security/Infra: P0 security + scaling roadmap

**Готово к разработке. Запускаем?**

