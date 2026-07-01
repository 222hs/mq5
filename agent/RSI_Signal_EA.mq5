//+------------------------------------------------------------------+
//|  RSI EA - يفتح ويسكر صفقات تلقائياً                              |
//+------------------------------------------------------------------+
input int    RSI_Period  = 14;
input int    RSI_Buy     = 30;
input int    RSI_Sell    = 70;
input double LotSize     = 0.01;
input int    StopLoss    = 50;
input int    TakeProfit  = 100;

int rsiHandle;
datetime lastBar;

//+------------------------------------------------------------------+
int OnInit()
  {
   rsiHandle = iRSI(_Symbol, _Period, RSI_Period, PRICE_CLOSE);
   if(rsiHandle == INVALID_HANDLE)
     {
      Print("❌ فشل تهيئة RSI");
      return(INIT_FAILED);
     }
   Print("✅ EA شغال على ", _Symbol);
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   IndicatorRelease(rsiHandle);
  }

//+------------------------------------------------------------------+
bool OpenBuy()
  {
   double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   double sl = NormalizeDouble(ask - StopLoss * point * 10, digits);
   double tp = NormalizeDouble(ask + TakeProfit * point * 10, digits);

   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   req.action    = TRADE_ACTION_DEAL;
   req.symbol    = _Symbol;
   req.volume    = LotSize;
   req.type      = ORDER_TYPE_BUY;
   req.price     = ask;
   req.sl        = sl;
   req.tp        = tp;
   req.deviation = 10;
   req.magic     = 123456;
   req.comment   = "RSI_EA";

   if(!OrderSend(req, res))
     {
      Print("❌ فشل فتح BUY: ", res.retcode);
      return false;
     }
   Print("✅ فتح BUY | السعر: ", ask, " | SL: ", sl, " | TP: ", tp);
   return true;
  }

//+------------------------------------------------------------------+
bool OpenSell()
  {
   double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   double sl = NormalizeDouble(bid + StopLoss * point * 10, digits);
   double tp = NormalizeDouble(bid - TakeProfit * point * 10, digits);

   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   req.action    = TRADE_ACTION_DEAL;
   req.symbol    = _Symbol;
   req.volume    = LotSize;
   req.type      = ORDER_TYPE_SELL;
   req.price     = bid;
   req.sl        = sl;
   req.tp        = tp;
   req.deviation = 10;
   req.magic     = 123456;
   req.comment   = "RSI_EA";

   if(!OrderSend(req, res))
     {
      Print("❌ فشل فتح SELL: ", res.retcode);
      return false;
     }
   Print("✅ فتح SELL | السعر: ", bid, " | SL: ", sl, " | TP: ", tp);
   return true;
  }

//+------------------------------------------------------------------+
void CloseAll()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket <= 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != 123456) continue;

      MqlTradeRequest req = {};
      MqlTradeResult  res = {};
      req.action    = TRADE_ACTION_DEAL;
      req.symbol    = PositionGetString(POSITION_SYMBOL);
      req.volume    = PositionGetDouble(POSITION_VOLUME);
      req.deviation = 10;
      req.magic     = 123456;
      req.position  = ticket;

      if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
        {
         req.type  = ORDER_TYPE_SELL;
         req.price = SymbolInfoDouble(req.symbol, SYMBOL_BID);
        }
      else
        {
         req.type  = ORDER_TYPE_BUY;
         req.price = SymbolInfoDouble(req.symbol, SYMBOL_ASK);
        }

      if(!OrderSend(req, res))
         Print("❌ فشل إغلاق صفقة: ", ticket, " كود: ", res.retcode);
      else
         Print("✅ تم إغلاق صفقة: ", ticket);
     }
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   datetime currentBar = iTime(_Symbol, _Period, 0);
   if(currentBar == lastBar) return;
   lastBar = currentBar;

   double rsi[2];
   if(CopyBuffer(rsiHandle, 0, 1, 2, rsi) < 2) return;

   // هل عندنا صفقة مفتوحة من هذا الـ EA؟
   bool hasPosition  = false;
   ENUM_POSITION_TYPE posType = POSITION_TYPE_BUY;
   for(int i = 0; i < PositionsTotal(); i++)
     {
      if(PositionGetTicket(i) > 0 && PositionGetInteger(POSITION_MAGIC) == 123456)
        {
         hasPosition = true;
         posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
         break;
        }
     }

   // RSI طلع من ذروة البيع (تحت 30) → شراء
   if(rsi[1] < RSI_Buy && rsi[0] > RSI_Buy)
     {
      if(hasPosition && posType == POSITION_TYPE_SELL) CloseAll();
      if(!hasPosition) OpenBuy();
     }

   // RSI نزل من ذروة الشراء (فوق 70) → بيع
   if(rsi[1] > RSI_Sell && rsi[0] < RSI_Sell)
     {
      if(hasPosition && posType == POSITION_TYPE_BUY) CloseAll();
      if(!hasPosition) OpenSell();
     }
  }
//+------------------------------------------------------------------+
