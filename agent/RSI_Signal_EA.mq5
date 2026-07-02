//+------------------------------------------------------------------+
//|  Scalper EA - يفتح صفقات بسرعة ويسكرها بربح                      |
//+------------------------------------------------------------------+
input double LotSize     = 0.01;
input int    TakeProfit  = 20;   // نقاط ربح
input int    StopLoss    = 30;   // نقاط خسارة
input int    RSI_Period  = 7;    // RSI سريع
input int    MaxSpread   = 30;   // أقصى سبريد

int      rsiHandle;
datetime lastBar;

//+------------------------------------------------------------------+
int OnInit()
  {
   rsiHandle = iRSI(_Symbol, PERIOD_CURRENT, RSI_Period, PRICE_CLOSE);
   if(rsiHandle == INVALID_HANDLE)
     {
      Print("❌ فشل تهيئة RSI");
      return(INIT_FAILED);
     }
   Print("✅ Scalper EA شغال على ", _Symbol, " TF:", EnumToString(Period()));
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   IndicatorRelease(rsiHandle);
  }

//+------------------------------------------------------------------+
bool HasPosition()
  {
   for(int i = 0; i < PositionsTotal(); i++)
     {
      if(PositionGetTicket(i) > 0 &&
         PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == 777777)
         return true;
     }
   return false;
  }

//+------------------------------------------------------------------+
void OpenTrade(ENUM_ORDER_TYPE type)
  {
   int spread = (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > MaxSpread)
     {
      Print("⚠️ سبريد عالي: ", spread);
      return;
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
   req.deviation = 20;
   req.magic     = 777777;
   req.comment   = "Scalper";

   if(!OrderSend(req, res))
      Print("❌ فشل الفتح كود: ", res.retcode);
   else
      Print("✅ ", (type == ORDER_TYPE_BUY ? "BUY" : "SELL"), " @ ", price, " TP:", tp, " SL:", sl);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   datetime currentBar = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(currentBar == lastBar) return;
   lastBar = currentBar;

   if(HasPosition()) return;

   double rsi[2];
   if(CopyBuffer(rsiHandle, 0, 1, 2, rsi) < 2) return;

   // شراء: RSI كان تحت 30 وارتد للأعلى
   if(rsi[1] < 30 && rsi[0] > rsi[1])
      OpenTrade(ORDER_TYPE_BUY);

   // بيع: RSI كان فوق 70 وانعكس للأسفل
   if(rsi[1] > 70 && rsi[0] < rsi[1])
      OpenTrade(ORDER_TYPE_SELL);
  }
//+------------------------------------------------------------------+
