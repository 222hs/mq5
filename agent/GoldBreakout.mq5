//+------------------------------------------------------------------+
//|                                                GoldBreakout.mq5  |
//|          XAUUSD — London/NY Session Breakout با OCO Pending       |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\OrderInfo.mqh>

//--- inputs
input double LotSize         = 0.5;
input int    RangeBars       = 30;     // عدد الشمعات لحساب النطاق قبل الجلسة
input int    BreakoutOffset  = 30;     // نقاط فوق/تحت النطاق لوضع الأوردر
input double ATR_Period      = 14;
input double RangeMaxATR     = 1.5;   // النطاق يجب < 1.5×ATR
input int    ExpireMinutes   = 60;    // إلغاء الأوردرات بعد 60 دقيقة
input int    MaxSpread       = 40;
input int    MaxPositions    = 2;
input int    MagicNum        = 11002;

// جلستا لندن ونيويورك (UTC)
input int    LondonOpen      = 7;     // 07:00 UTC
input int    NYOpen          = 13;    // 13:00 UTC
input int    SessionCloseUTC = 21;   // نهاية الجلسة

// TP/SL
input double TP_RangeMulti   = 1.5;  // TP = 1.5 × عرض النطاق
input double SL_RangeMulti   = 1.0;  // SL = 1.0 × عرض النطاق (الطرف الآخر)

//--- globals
CTrade        trade;
CPositionInfo posInfo;
COrderInfo    ordInfo;
int    hATR;

ulong  g_stopTicket  = 0;
ulong  g_limitTicket = 0; // Sell Stop في هذا النظام
datetime g_ordersPlacedAt = 0;
bool   g_sessionTraded = false; // صفقة واحدة في الجلسة
int    g_lastSessionHour = -1;

//+------------------------------------------------------------------+
bool OrderExists(ulong ticket)
  {
   if(ticket == 0) return false;
   for(int i = OrdersTotal()-1; i >= 0; i--)
      if(ordInfo.SelectByIndex(i))
         if(ordInfo.Ticket() == ticket) return true;
   return false;
  }

void CancelOrders()
  {
   if(OrderExists(g_stopTicket))  trade.OrderDelete(g_stopTicket);
   if(OrderExists(g_limitTicket)) trade.OrderDelete(g_limitTicket);
   g_stopTicket  = 0;
   g_limitTicket = 0;
   g_ordersPlacedAt = 0;
  }

void CheckOCO()
  {
   bool buyExists  = OrderExists(g_stopTicket);
   bool sellExists = OrderExists(g_limitTicket);
   if(!buyExists  && g_stopTicket  != 0 && sellExists) { trade.OrderDelete(g_limitTicket); g_limitTicket=0; g_stopTicket=0; }
   if(!sellExists && g_limitTicket != 0 && buyExists)  { trade.OrderDelete(g_stopTicket);  g_stopTicket=0;  g_limitTicket=0; }
   if(!buyExists && !sellExists) { g_stopTicket=0; g_limitTicket=0; g_ordersPlacedAt=0; }
  }

int CountPos()
  {
   int n = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==MagicNum) n++;
   return n;
  }

double NormLot(double lot)
  {
   double mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double mx=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(st>0) lot=MathFloor(lot/st)*st;
   return MathMax(mn,MathMin(mx,lot));
  }

bool IsSessionOpen()
  {
   MqlDateTime dt; TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   return (h >= LondonOpen && h < SessionCloseUTC);
  }

bool IsSessionStart()
  {
   MqlDateTime dt; TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   // أول 5 دقائق من افتتاح لندن أو نيويورك
   bool londonStart = (h == LondonOpen);
   bool nyStart     = (h == NYOpen);
   return (londonStart || nyStart) && (g_lastSessionHour != h);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(MagicNum);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);

   hATR = iATR(_Symbol, PERIOD_M1, (int)ATR_Period);
   if(hATR == INVALID_HANDLE) { Print("GoldBreakout: ATR init failed"); return INIT_FAILED; }

   Print("GoldBreakout initialized | RangeBars=", RangeBars, " Offset=", BreakoutOffset,
         " Expire=", ExpireMinutes, "min");
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   CancelOrders();
   IndicatorRelease(hATR);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   CheckOCO();

   MqlDateTime dt; TimeToStruct(TimeGMT(), dt);
   int curHour = dt.hour;

   // إعادة تعيين عند بداية يوم جديد
   if(curHour == 0 && g_sessionTraded) g_sessionTraded = false;

   // إلغاء الأوردرات المنتهية الصلاحية
   if(g_ordersPlacedAt != 0)
     {
      int elapsed = (int)(TimeCurrent() - g_ordersPlacedAt) / 60;
      if(elapsed >= ExpireMinutes) { CancelOrders(); return; }
     }

   // فلاتر
   if(CountPos() >= MaxPositions) return;
   if(!IsSessionOpen())           return;
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > MaxSpread)         return;

   // لا نضع أوردرات لو في أوردرات معلقة أو صفقة مفتوحة
   if(g_stopTicket != 0 || g_limitTicket != 0) return;
   if(CountPos() > 0) return;

   // هل هذه بداية جلسة جديدة؟
   if(!IsSessionStart()) return;
   g_lastSessionHour = curHour;

   // احسب نطاق الشمعات السابقة
   double highs[], lows[], atr[];
   ArraySetAsSeries(highs, true); ArraySetAsSeries(lows, true); ArraySetAsSeries(atr, true);
   if(CopyHigh(_Symbol, PERIOD_M1, 1, RangeBars, highs) < RangeBars) return;
   if(CopyLow (_Symbol, PERIOD_M1, 1, RangeBars, lows)  < RangeBars) return;
   if(CopyBuffer(hATR, 0, 1, 1, atr) < 1) return;

   double rangeHigh = highs[ArrayMaximum(highs, 0, RangeBars)];
   double rangeLow  = lows [ArrayMinimum(lows,  0, RangeBars)];
   double rangeSize = rangeHigh - rangeLow;

   // فلتر: النطاق يجب أن يكون ضيقاً (< 1.5 × ATR)
   if(rangeSize > RangeMaxATR * atr[0])
     { Print("GoldBreakout: range too wide (", DoubleToString(rangeSize,_Digits), " > ", DoubleToString(RangeMaxATR*atr[0],_Digits), ")"); return; }

   double tickSz= SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double ask   = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid   = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   int    digs  = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   sl0   = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minD  = MathMax((double)(sl0+5), 10.0) * tickSz;
   double offset= MathMax(BreakoutOffset * tickSz, minD);
   double lot   = NormLot(LotSize);

   double tpDist = MathMax(rangeSize * TP_RangeMulti, minD*2);
   double slDist = MathMax(rangeSize * SL_RangeMulti, minD);

   // Buy Stop فوق قمة النطاق
   double buyStop  = NormalizeDouble(rangeHigh + offset, digs);
   double buySL    = NormalizeDouble(buyStop - slDist, digs);
   double buyTP    = NormalizeDouble(buyStop + tpDist, digs);

   // Sell Stop تحت قاع النطاق
   double sellStop = NormalizeDouble(rangeLow - offset, digs);
   double sellSL   = NormalizeDouble(sellStop + slDist, digs);
   double sellTP   = NormalizeDouble(sellStop - tpDist, digs);

   Print("GoldBreakout: placing OCO | High=", rangeHigh, " Low=", rangeLow,
         " Range=", DoubleToString(rangeSize,digs), " ATR=", DoubleToString(atr[0],digs));

   if(trade.BuyStop(lot, buyStop, _Symbol, buySL, buyTP, ORDER_TIME_GTC, 0, "BREAKOUT_BUY"))
      g_stopTicket = trade.ResultOrder();

   if(trade.SellStop(lot, sellStop, _Symbol, sellSL, sellTP, ORDER_TIME_GTC, 0, "BREAKOUT_SELL"))
      g_limitTicket = trade.ResultOrder();

   g_ordersPlacedAt = TimeCurrent();
  }
//+------------------------------------------------------------------+
