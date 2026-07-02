//+------------------------------------------------------------------+
//|  Scalper EA - سكالبينج سريع بربح صغير متكرر                      |
//+------------------------------------------------------------------+
input int    RSI_Period   = 14;
input int    RSI_Buy      = 35;
input int    RSI_Sell     = 65;
input double LotSize      = 0.01;
input int    TakeProfit   = 15;   // نقاط ربح
input int    StopLoss     = 20;   // نقاط خسارة
input int    MaxSpread    = 20;   // أقصى سبريد مسموح

int    rsiHandle;
int    maHandle;
datetime lastBar;

//+------------------------------------------------------------------+
int OnInit()
  {
   rsiHandle = iRSI(_Symbol, PERIOD_CURRENT, RSI_Period, PRICE_CLOSE);
   maHandle  = iMA(_Symbol, PERIOD_CURRENT, 50, 0, MODE_EMA, PRICE_CLOSE);

   if(rsiHandle == INVALID_HANDLE || maHandle == INVALID_HANDLE)
     {
      Print("❌ فشل تهيئة المؤشرات");
      return(INIT_FAILED);
     }
   Print("✅ Scalper EA شغال على ", _Symbol, " | TP: ", TakeProfit, " نقطة | SL: ", StopLoss, " نقطة");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   IndicatorRelease(rsiHandle);
   IndicatorRelease(maHandle);
  }

//+------------------------------------------------------------------+
bool HasOpenPosition(ENUM_POSITION_TYPE &posType)
  {
   for(int i = 0; i < PositionsTotal(); i++)
     {
      if(PositionGetTicket(i) > 0 &&
         PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == 999999)
        {
         posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
         return true;
        }
     }
   return false;
  }

//+------------------------------------------------------------------+
int GetSpread()
  {
   return (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
  }

//+------------------------------------------------------------------+
bool OpenTrade(ENUM_ORDER_TYPE type)
  {
   if(GetSpread() > MaxSpread)
     {
      Print("⚠️ سبريد عالي (", GetSpread(), ") - تم تخطي الصفقة");
      return false;
     }

   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double price, sl, tp;

   if(type == ORDER_TYPE_BUY)
     {
      price = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      sl    = NormalizeDouble(price - StopLoss * point * 10, digits);
      tp    = NormalizeDouble(price + TakeProfit * point * 10, digits);
     }
   else
     {
      price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      sl    = NormalizeDouble(price + StopLoss * point * 10, digits);
      tp    = NormalizeDouble(price - TakeProfit * point * 10, digits);
     }

   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   req.action    = TRADE_ACTION_DEAL;
   req.symbol    = _Symbol;
   req.volume    = LotSize;
   req.type      = type;
   req.price     = price;
   req.sl        = sl;
   req.tp        = tp;
   req.deviation = 10;
   req.magic     = 999999;
   req.comment   = "Scalper";

   if(!OrderSend(req, res))
     {
      Print("❌ فشل الفتح: ", res.retcode);
      return false;
     }

   string dir = (type == ORDER_TYPE_BUY) ? "BUY" : "SELL";
   Print("✅ فتح ", dir, " | السعر: ", price, " | TP: ", tp, " | SL: ", sl);
   return true;
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   // قراءة RSI
   double rsi[1];
   if(CopyBuffer(rsiHandle, 0, 1, 1, rsi) < 1) return;

   // قراءة EMA50 لتحديد الاتجاه
   double ma[1];
   if(CopyBuffer(maHandle, 0, 0, 1, ma) < 1) return;

   double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   // قراءة آخر شمعتين
   double closeArr[2], openArr[2];
   if(CopyClose(_Symbol, PERIOD_CURRENT, 1, 2, closeArr) < 2) return;
   if(CopyOpen(_Symbol, PERIOD_CURRENT, 1, 2, openArr) < 2) return;

   bool bullishCandle = closeArr[0] > openArr[0];  // شمعة صاعدة
   bool bearishCandle = closeArr[0] < openArr[0];  // شمعة هابطة
   bool aboveMA       = price > ma[0];              // السعر فوق EMA50
   bool belowMA       = price < ma[0];              // السعر تحت EMA50

   ENUM_POSITION_TYPE posType;
   bool hasPos = HasOpenPosition(posType);

   // شروط الشراء: RSI منخفض + شمعة صاعدة + سعر فوق EMA
   if(!hasPos && rsi[0] < RSI_Buy && bullishCandle && aboveMA)
     {
      OpenTrade(ORDER_TYPE_BUY);
     }

   // شروط البيع: RSI مرتفع + شمعة هابطة + سعر تحت EMA
   if(!hasPos && rsi[0] > RSI_Sell && bearishCandle && belowMA)
     {
      OpenTrade(ORDER_TYPE_SELL);
     }
  }
//+------------------------------------------------------------------+
