//+------------------------------------------------------------------+
//|                                                GoldScalperEA.mq5 |
//|                                        GoldScalperX version 7.00 |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "7.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- inputs
input double          LotSize      = 0.5;        // Lot size
input ENUM_TIMEFRAMES TF           = PERIOD_M1;  // Working timeframe
input int             MaxPositions = 3;          // Max open positions
input int             CooldownSecs = 10;         // Cooldown between entries (sec)
input int             MaxSpread    = 500;        // Max spread (points)

//--- constants
#define EA_NAME     "GoldScalperX"
#define EA_VERSION  "7.00"
#define GV_PREFIX   "GSX_"
#define DASH_PREFIX "GSX_D_"

//--- globals
CTrade         trade;
CPositionInfo  posInfo;

long     g_magic         = 0;
int      hRSI = INVALID_HANDLE, hEMA8 = INVALID_HANDLE, hEMA21 = INVALID_HANDLE, hATR = INVALID_HANDLE;
datetime g_lastEntryTime = 0;
int      g_totalTrades   = 0;

double   g_lot;
int      g_maxPositions;
int      g_cooldownSecs;
double   g_maxSpread;

//+------------------------------------------------------------------+
//| Magic number from symbol name hash (djb2)                        |
//+------------------------------------------------------------------+
long MagicFromSymbol(const string sym)
  {
   ulong h = 5381;
   int len = StringLen(sym);
   for(int i = 0; i < len; i++)
      h = ((h << 5) + h) + (ulong)StringGetCharacter(sym, i);
   return (long)(100000 + (h % 900000));
  }

//+------------------------------------------------------------------+
//| Read setting from MT5 Global Variable with fallback              |
//+------------------------------------------------------------------+
double GVOrDefault(const string name, const double fallback)
  {
   string gv = GV_PREFIX + name;
   if(GlobalVariableCheck(gv))
      return GlobalVariableGet(gv);
   return fallback;
  }

//+------------------------------------------------------------------+
void LoadSettings()
  {
   g_lot          = GVOrDefault("LotSize",      LotSize);
   g_maxSpread    = GVOrDefault("MaxSpread",    (double)MaxSpread);
   g_maxPositions = (int)GVOrDefault("MaxPositions", (double)MaxPositions);
   g_cooldownSecs = (int)GVOrDefault("CooldownSecs", (double)CooldownSecs);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_magic = MagicFromSymbol(_Symbol);

   trade.SetExpertMagicNumber(g_magic);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);

   hRSI   = iRSI(_Symbol, TF, 7, PRICE_CLOSE);
   hEMA8  = iMA(_Symbol, TF, 8,  0, MODE_EMA, PRICE_CLOSE);
   hEMA21 = iMA(_Symbol, TF, 21, 0, MODE_EMA, PRICE_CLOSE);
   hATR   = iATR(_Symbol, TF, 14);

   if(hRSI == INVALID_HANDLE || hEMA8 == INVALID_HANDLE ||
      hEMA21 == INVALID_HANDLE || hATR == INVALID_HANDLE)
     {
      Print(EA_NAME, ": failed to create indicator handles");
      return(INIT_FAILED);
     }

   LoadSettings();
   CreateDashboard();
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   if(hRSI   != INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hEMA8  != INVALID_HANDLE) IndicatorRelease(hEMA8);
   if(hEMA21 != INVALID_HANDLE) IndicatorRelease(hEMA21);
   if(hATR   != INVALID_HANDLE) IndicatorRelease(hATR);
   ObjectsDeleteAll(0, DASH_PREFIX);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
//| Count positions of this EA on this symbol                        |
//+------------------------------------------------------------------+
int CountMyPositions()
  {
   int cnt = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol() == _Symbol && posInfo.Magic() == g_magic)
            cnt++;
   return cnt;
  }

//+------------------------------------------------------------------+
double MyFloatingPL()
  {
   double pl = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol() == _Symbol && posInfo.Magic() == g_magic)
            pl += posInfo.Profit() + posInfo.Swap();
   return pl;
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   LoadSettings();

   //--- indicator buffers (series orientation: index 0 = current)
   double rsi[], ema8[], ema21[], atr[], close[];
   ArraySetAsSeries(rsi,   true);
   ArraySetAsSeries(ema8,  true);
   ArraySetAsSeries(ema21, true);
   ArraySetAsSeries(atr,   true);
   ArraySetAsSeries(close, true);

   if(CopyBuffer(hRSI,   0, 0, 3, rsi)   < 3) return;
   if(CopyBuffer(hEMA8,  0, 0, 3, ema8)  < 3) return;
   if(CopyBuffer(hEMA21, 0, 0, 3, ema21) < 3) return;
   if(CopyBuffer(hATR,   0, 0, 2, atr)   < 2) return;
   if(CopyClose(_Symbol, TF, 0, 3, close) < 3) return;

   double curRSI  = rsi[0];
   double curATR  = atr[0];
   bool   emaUp   = ema8[0] > ema21[0];
   bool   emaDown = ema8[0] < ema21[0];
   bool   crossDn = (ema8[1] >= ema21[1] && ema8[0] < ema21[0]);
   bool   crossUp = (ema8[1] <= ema21[1] && ema8[0] > ema21[0]);
   bool   momUp   = close[0] > close[1];
   bool   momDown = close[0] < close[1];

   //--- smart exits + trailing
   ManagePositions(curRSI, crossUp, crossDn, curATR);

   //--- entry signal
   string signal = "NONE";
   if(emaUp && curRSI >= 45.0 && curRSI <= 75.0 && momUp)
      signal = "BUY";
   else if(emaDown && curRSI >= 25.0 && curRSI <= 55.0 && momDown)
      signal = "SELL";

   //--- entry filters
   long spread     = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   bool spreadOK   = (spread <= (long)g_maxSpread);
   bool cooldownOK = (TimeCurrent() - g_lastEntryTime >= g_cooldownSecs);
   bool slotsOK    = (CountMyPositions() < g_maxPositions);

   if(signal != "NONE" && spreadOK && cooldownOK && slotsOK && curATR > 0.0)
     {
      if(signal == "BUY")
         OpenTrade(ORDER_TYPE_BUY, curATR);
      else
         OpenTrade(ORDER_TYPE_SELL, curATR);
     }

   UpdateDashboard(emaUp, emaDown, curRSI, signal, spreadOK && cooldownOK && slotsOK);
  }

//+------------------------------------------------------------------+
void OpenTrade(const ENUM_ORDER_TYPE type, const double atrVal)
  {
   double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = stopsLevel * point;

   double slDist = MathMax(atrVal * 1.5, minDist);
   double tpDist = MathMax(atrVal * 2.5, minDist);

   double lot = NormalizeLot(g_lot);
   double sl, tp;
   bool   ok;

   if(type == ORDER_TYPE_BUY)
     {
      sl = NormalizeDouble(ask - slDist, digits);
      tp = NormalizeDouble(ask + tpDist, digits);
      ok = trade.Buy(lot, _Symbol, ask, sl, tp, EA_NAME);
     }
   else
     {
      sl = NormalizeDouble(bid + slDist, digits);
      tp = NormalizeDouble(bid - tpDist, digits);
      ok = trade.Sell(lot, _Symbol, bid, sl, tp, EA_NAME);
     }

   if(ok)
     {
      g_lastEntryTime = TimeCurrent();
      g_totalTrades++;
     }
  }

//+------------------------------------------------------------------+
double NormalizeLot(double lot)
  {
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(lotStep > 0.0)
      lot = MathFloor(lot / lotStep) * lotStep;
   lot = MathMax(minLot, MathMin(maxLot, lot));
   return lot;
  }

//+------------------------------------------------------------------+
//| Smart exits and ATR trailing stop                                |
//+------------------------------------------------------------------+
void ManagePositions(const double curRSI, const bool crossUp,
                     const bool crossDn, const double atrVal)
  {
   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = stopsLevel * point;
   double trail   = MathMax(atrVal * 1.0, minDist);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(!posInfo.SelectByIndex(i))
         continue;
      if(posInfo.Symbol() != _Symbol || posInfo.Magic() != g_magic)
         continue;

      ulong  ticket    = posInfo.Ticket();
      double openPrice = posInfo.PriceOpen();
      double curPrice  = posInfo.PriceCurrent();
      double sl        = posInfo.StopLoss();
      double tp        = posInfo.TakeProfit();

      if(posInfo.PositionType() == POSITION_TYPE_BUY)
        {
         double priceGain = curPrice - openPrice;
         //--- smart close
         if(curRSI > 75.0 || crossDn || (atrVal > 0.0 && priceGain >= atrVal * 1.5))
           {
            trade.PositionClose(ticket);
            continue;
           }
         //--- trailing stop
         if(atrVal > 0.0 && priceGain > trail)
           {
            double newSL = NormalizeDouble(curPrice - trail, digits);
            if(newSL > sl + point && curPrice - newSL >= minDist)
               trade.PositionModify(ticket, newSL, tp);
           }
        }
      else // SELL
        {
         double priceGain = openPrice - curPrice;
         if(curRSI < 25.0 || crossUp || (atrVal > 0.0 && priceGain >= atrVal * 1.5))
           {
            trade.PositionClose(ticket);
            continue;
           }
         if(atrVal > 0.0 && priceGain > trail)
           {
            double newSL = NormalizeDouble(curPrice + trail, digits);
            if((sl == 0.0 || newSL < sl - point) && newSL - curPrice >= minDist)
               trade.PositionModify(ticket, newSL, tp);
           }
        }
     }
  }

//+------------------------------------------------------------------+
//| Dashboard                                                        |
//+------------------------------------------------------------------+
void CreateDashboard()
  {
   string bg = DASH_PREFIX + "BG";
   ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, bg, OBJPROP_CORNER,      CORNER_LEFT_UPPER);
   ObjectSetInteger(0, bg, OBJPROP_XDISTANCE,   10);
   ObjectSetInteger(0, bg, OBJPROP_YDISTANCE,   20);
   ObjectSetInteger(0, bg, OBJPROP_XSIZE,       250);
   ObjectSetInteger(0, bg, OBJPROP_YSIZE,       205);
   ObjectSetInteger(0, bg, OBJPROP_BGCOLOR,     C'15,15,25');
   ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, bg, OBJPROP_COLOR,       clrDimGray);
   ObjectSetInteger(0, bg, OBJPROP_BACK,        false);
   ObjectSetInteger(0, bg, OBJPROP_SELECTABLE,  false);
   ObjectSetInteger(0, bg, OBJPROP_HIDDEN,      true);

   string labels[9] = {"TITLE","MAGIC","TREND","RSI","SIGNAL","ENTRY","POS","PL","TRADES"};
   for(int i = 0; i < 9; i++)
     {
      string name = DASH_PREFIX + labels[i];
      ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, name, OBJPROP_CORNER,     CORNER_LEFT_UPPER);
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE,  20);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE,  28 + i * 20);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE,   9);
      ObjectSetString (0, name, OBJPROP_FONT,       "Consolas");
      ObjectSetInteger(0, name, OBJPROP_COLOR,      clrWhite);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN,     true);
     }
  }

//+------------------------------------------------------------------+
void SetLabel(const string suffix, const string text, const color clr)
  {
   string name = DASH_PREFIX + suffix;
   ObjectSetString (0, name, OBJPROP_TEXT,  text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
  }

//+------------------------------------------------------------------+
void UpdateDashboard(const bool emaUp, const bool emaDown, const double rsiVal,
                     const string signal, const bool ready)
  {
   string trend = emaUp ? "UP" : (emaDown ? "DOWN" : "FLAT");
   color  trClr = emaUp ? clrLime : (emaDown ? clrOrangeRed : clrSilver);

   int    posCount = CountMyPositions();
   double floatPL  = MyFloatingPL();
   long   cdLeft   = (long)g_cooldownSecs - (long)(TimeCurrent() - g_lastEntryTime);

   SetLabel("TITLE",  EA_NAME + " v" + EA_VERSION + "  " + _Symbol, clrGold);
   SetLabel("MAGIC",  "Magic   : " + (string)g_magic, clrSilver);
   SetLabel("TREND",  "Trend   : " + trend, trClr);
   SetLabel("RSI",    "RSI(7)  : " + DoubleToString(rsiVal, 2), clrDeepSkyBlue);
   SetLabel("SIGNAL", "Signal  : " + signal,
            signal == "BUY" ? clrLime : (signal == "SELL" ? clrOrangeRed : clrSilver));
   SetLabel("ENTRY",  "Entry   : " + (ready ? "READY" :
            (cdLeft > 0 ? "COOLDOWN " + (string)cdLeft + "s" : "BLOCKED")),
            ready ? clrLime : clrYellow);
   SetLabel("POS",    "Open Pos: " + (string)posCount + " / " + (string)g_maxPositions, clrWhite);
   SetLabel("PL",     "Float PL: " + DoubleToString(floatPL, 2),
            floatPL >= 0.0 ? clrLime : clrOrangeRed);
   SetLabel("TRADES", "Trades  : " + (string)g_totalTrades, clrSilver);

   ChartRedraw();
  }
//+------------------------------------------------------------------+
