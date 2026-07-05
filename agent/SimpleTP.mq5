//+------------------------------------------------------------------+
//|                                                      SimpleTP.mq5 |
//|                         يفتح Buy/Sell بالتناوب ويسكر بالربح      |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

input double InpLot    = 0.1;   // حجم اللوت
input int    InpTP     = 100;   // Take Profit (نقاط)
input int    InpSL     = 200;   // Stop Loss (نقاط)
input int    InpMagic  = 55501;

CTrade        trade;
CPositionInfo pos;
bool g_lastWasBuy = false;

//+------------------------------------------------------------------+
int CountPos()
  {
   int n = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
      if(pos.SelectByIndex(i))
         if(pos.Symbol() == _Symbol && pos.Magic() == InpMagic) n++;
   return n;
  }

void OpenTrade(ENUM_ORDER_TYPE type)
  {
   double tickSz = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   long   sl0    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minD   = MathMax((double)(sl0 + 10), 20.0) * tickSz;
   double tpD    = MathMax(InpTP * tickSz, minD);
   double slD    = MathMax(InpSL * tickSz, minD);
   int    digs   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   double price, sl, tp;
   if(type == ORDER_TYPE_BUY)
     {
      price = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      sl    = NormalizeDouble(price - slD, digs);
      tp    = NormalizeDouble(price + tpD, digs);
     }
   else
     {
      price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      sl    = NormalizeDouble(price + slD, digs);
      tp    = NormalizeDouble(price - tpD, digs);
     }

   long fillMode = SymbolInfoInteger(_Symbol, SYMBOL_FILLING_MODE);
   ENUM_ORDER_TYPE_FILLING fill;
   if((fillMode & SYMBOL_FILLING_FOK) != 0)      fill = ORDER_FILLING_FOK;
   else if((fillMode & SYMBOL_FILLING_IOC) != 0) fill = ORDER_FILLING_IOC;
   else                                           fill = ORDER_FILLING_RETURN;

   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   req.action       = TRADE_ACTION_DEAL;
   req.symbol       = _Symbol;
   req.volume       = InpLot;
   req.type         = type;
   req.price        = price;
   req.sl           = sl;
   req.tp           = tp;
   req.deviation    = 50;
   req.magic        = InpMagic;
   req.type_filling = fill;
   req.comment      = (type == ORDER_TYPE_BUY) ? "STP_BUY" : "STP_SEL";

   if(OrderSend(req, res))
     {
      g_lastWasBuy = (type == ORDER_TYPE_BUY);
      Print("SimpleTP: ", (type==ORDER_TYPE_BUY?"BUY":"SELL"),
            " #", res.order, " TP=", tp, " SL=", sl);
     }
   else
      Print("SimpleTP: error ", GetLastError(), " / ", res.retcode);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);
   Print("SimpleTP ready | TP=", InpTP, " SL=", InpSL, " Lot=", InpLot);
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
datetime g_lastBar = 0;

void OnTick()
  {
   // فقط عند شمعة جديدة
   datetime barTime = iTime(_Symbol, PERIOD_M1, 0);
   if(barTime == g_lastBar) return;
   g_lastBar = barTime;

   // لو في صفقة مفتوحة، انتظر
   if(CountPos() > 0) return;

   // افتح عكس الصفقة السابقة
   if(g_lastWasBuy)
      OpenTrade(ORDER_TYPE_SELL);
   else
      OpenTrade(ORDER_TYPE_BUY);
  }
//+------------------------------------------------------------------+
