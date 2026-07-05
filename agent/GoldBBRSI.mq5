//+------------------------------------------------------------------+
//|                                                    GoldBBRSI.mq5 |
//|             XAUUSD M1 — Bollinger Bands + RSI + ADX Mean Revert  |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- inputs
input double          LotSize      = 0.5;
input ENUM_TIMEFRAMES TF           = PERIOD_M1;
input int             BB_Period    = 20;
input double          BB_Dev       = 2.5;
input int             RSI_Period   = 7;
input double          RSI_OB      = 75.0;   // Overbought
input double          RSI_OS      = 25.0;   // Oversold
input int             ADX_Period   = 14;
input double          ADX_Max     = 25.0;   // فلتر: سوق عرضي فقط
input int             TP_Points    = 180;   // نقاط (1 نقطة = 0.01$)
input int             SL_Points    = 280;
input int             MaxBarsHold  = 15;    // خروج زمني بعد 15 شمعة
input int             MaxSpread    = 40;
input bool            UseSession   = true;
input int             SessionStart = 0;     // UTC
input int             SessionEnd   = 21;    // UTC
input int             MaxPositions = 3;
input int             MagicNum     = 11001;

//--- globals
CTrade        trade;
CPositionInfo posInfo;
int    hBB, hRSI, hADX;
datetime g_lastBar = 0;

//+------------------------------------------------------------------+
bool SessionOK()
  {
   if(!UseSession) return true;
   MqlDateTime dt; TimeToStruct(TimeGMT(), dt);
   return (dt.hour >= SessionStart && dt.hour < SessionEnd);
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

//--- إدارة الصفقات المفتوحة: خروج زمني + TP/SL بالمؤشرات
void ManagePositions()
  {
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol || posInfo.Magic()!=MagicNum) continue;
      ulong    tk      = posInfo.Ticket();
      datetime openAt  = (datetime)posInfo.Time();
      int      age     = (int)((TimeCurrent()-openAt)/60); // عمر الصفقة بالدقائق

      double profit = posInfo.Profit() + posInfo.Swap();
      double tpDist = TP_Points * tickSize;
      double slDist = SL_Points * tickSize;

      // TP
      if(profit >= tpDist * NormLot(LotSize) * 100)
        { trade.PositionClose(tk); continue; }

      // SL
      if(profit <= -slDist * NormLot(LotSize) * 100)
        { trade.PositionClose(tk); continue; }

      // خروج زمني
      if(age >= MaxBarsHold)
        { trade.PositionClose(tk); continue; }
     }
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(MagicNum);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);

   hBB  = iBands(_Symbol, TF, BB_Period, 0, BB_Dev, PRICE_CLOSE);
   hRSI = iRSI  (_Symbol, TF, RSI_Period, PRICE_CLOSE);
   hADX = iADX  (_Symbol, TF, ADX_Period);

   if(hBB==INVALID_HANDLE||hRSI==INVALID_HANDLE||hADX==INVALID_HANDLE)
     { Print("GoldBBRSI: indicator init failed"); return INIT_FAILED; }

   Print("GoldBBRSI initialized | BB(", BB_Period, ",", BB_Dev, ") RSI(", RSI_Period, ") ADX<", ADX_Max);
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   IndicatorRelease(hBB);
   IndicatorRelease(hRSI);
   IndicatorRelease(hADX);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   ManagePositions();

   datetime barTime = iTime(_Symbol, TF, 0);
   if(barTime == g_lastBar) return;
   g_lastBar = barTime;

   // فلاتر
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > MaxSpread)      return;
   if(!SessionOK())            return;
   if(CountPos() >= MaxPositions) return;

   // بيانات المؤشرات (الشمعة المغلقة [1])
   double upper[2], lower[2], rsi[2], adx[2], close[2];
   ArraySetAsSeries(upper,true); ArraySetAsSeries(lower,true);
   ArraySetAsSeries(rsi,true);   ArraySetAsSeries(adx,true);
   ArraySetAsSeries(close,true);

   if(CopyBuffer(hBB,  1, 0, 2, upper) < 2) return; // upper band
   if(CopyBuffer(hBB,  2, 0, 2, lower) < 2) return; // lower band
   if(CopyBuffer(hRSI, 0, 0, 2, rsi)   < 2) return;
   if(CopyBuffer(hADX, 0, 0, 2, adx)   < 2) return;
   if(CopyClose(_Symbol, TF, 0, 2, close) < 2) return;

   double tickSz = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double ask  = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid  = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   int    digs = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   sl0  = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minD = MathMax((double)(sl0+5), 10.0) * tickSz;
   double tpD  = MathMax(TP_Points * tickSz, minD);
   double slD  = MathMax(SL_Points * tickSz, minD);
   double lot  = NormLot(LotSize);

   bool adxOK = (adx[1] < ADX_Max); // سوق عرضي فقط

   // BUY: إغلاق تحت الحد السفلي + RSI oversold + ADX عرضي
   if(close[1] < lower[1] && rsi[1] < RSI_OS && adxOK)
     {
      double sl = NormalizeDouble(ask - slD, digs);
      double tp = NormalizeDouble(ask + tpD, digs);
      trade.Buy(lot, _Symbol, ask, sl, tp, "BBRSI_BUY");
     }

   // SELL: إغلاق فوق الحد العلوي + RSI overbought + ADX عرضي
   else if(close[1] > upper[1] && rsi[1] > RSI_OB && adxOK)
     {
      double sl = NormalizeDouble(bid + slD, digs);
      double tp = NormalizeDouble(bid - tpD, digs);
      trade.Sell(lot, _Symbol, bid, sl, tp, "BBRSI_SELL");
     }
  }
//+------------------------------------------------------------------+
