//+------------------------------------------------------------------+
//|                                                GoldScalperEA.mq5 |
//|                                        GoldScalperX version 9.00 |
//|  Gold-specialized scalper — EMA9/21 + RSI7 + session filter      |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "9.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- inputs
input double          LotSize      = 0.5;       // Lot size
input ENUM_TIMEFRAMES TF           = PERIOD_M1; // Working timeframe
input int             MaxPositions = 15;        // Max open positions
input int             CooldownSecs = 3;         // Cooldown between entries (sec)
input int             MaxSpread    = 150;       // Max spread in points (150=15 pips)
input bool            UseSession   = true;      // Filter: London+NY sessions only

//--- constants
#define EA_NAME      "GoldScalperX"
#define EA_VERSION   "9.00"
#define DASH_PREFIX  "GSX_D_"
#define SETTINGS_FILE "GSX_Settings.json"

//--- globals
CTrade         trade;
CPositionInfo  posInfo;

long     g_magic         = 0;
int      hRSI = INVALID_HANDLE, hEMA9 = INVALID_HANDLE, hEMA21 = INVALID_HANDLE, hATR = INVALID_HANDLE;
datetime g_lastEntryTime = 0;
int      g_totalTrades   = 0;

double   g_lot;
int      g_maxPositions;
int      g_cooldownSecs;
double   g_maxSpread;

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
//| Read a value from GSX_Settings.json (Common\Files folder)       |
//+------------------------------------------------------------------+
double ReadJsonValue(const string key, const double fallback)
  {
   int h = FileOpen(SETTINGS_FILE, FILE_READ|FILE_TXT|FILE_COMMON);
   if(h == INVALID_HANDLE) return fallback;
   string content = "";
   while(!FileIsEnding(h))
      content += FileReadString(h);
   FileClose(h);

   // simple key search: "key": value
   string search = "\"" + key + "\"";
   int pos = StringFind(content, search);
   if(pos < 0) return fallback;
   pos += StringLen(search);
   // skip whitespace and colon
   while(pos < StringLen(content) && (StringGetCharacter(content,pos)==' ' ||
         StringGetCharacter(content,pos)==':' || StringGetCharacter(content,pos)=='\t'))
      pos++;
   // read number
   string num = "";
   while(pos < StringLen(content))
     {
      ushort c = StringGetCharacter(content, pos);
      if(c=='-' || c=='.' || (c>='0' && c<='9'))
        { num += ShortToString(c); pos++; }
      else break;
     }
   if(StringLen(num) == 0) return fallback;
   return StringToDouble(num);
  }

//+------------------------------------------------------------------+
void LoadSettings()
  {
   g_lot          = ReadJsonValue("LotSize",      LotSize);
   g_maxSpread    = ReadJsonValue("MaxSpread",    (double)MaxSpread);
   g_maxPositions = (int)ReadJsonValue("MaxPositions", (double)MaxPositions);
   g_cooldownSecs = (int)ReadJsonValue("CooldownSecs", (double)CooldownSecs);
  }

//+------------------------------------------------------------------+
//| Check if current hour is within London or NY session (UTC)       |
//+------------------------------------------------------------------+
bool InTradingSession()
  {
   if(!UseSession) return true;
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   // London: 07:00-17:00 UTC | NY: 13:00-21:00 UTC → combined 07:00-21:00
   return (h >= 7 && h < 21);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_magic = MagicFromSymbol(_Symbol);
   trade.SetExpertMagicNumber(g_magic);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);

   hRSI   = iRSI(_Symbol, TF, 7, PRICE_CLOSE);
   hEMA9  = iMA(_Symbol, TF, 9,  0, MODE_EMA, PRICE_CLOSE);
   hEMA21 = iMA(_Symbol, TF, 21, 0, MODE_EMA, PRICE_CLOSE);
   hATR   = iATR(_Symbol, TF, 7);

   if(hRSI == INVALID_HANDLE || hEMA9 == INVALID_HANDLE ||
      hEMA21 == INVALID_HANDLE || hATR == INVALID_HANDLE)
     {
      Print(EA_NAME, ": failed to create indicator handles");
      return(INIT_FAILED);
     }

   LoadSettings();
   CreateDashboard();
   Print(EA_NAME, " v", EA_VERSION, " initialized | Magic=", g_magic,
         " | TF=", EnumToString(TF));
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   if(hRSI   != INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hEMA9  != INVALID_HANDLE) IndicatorRelease(hEMA9);
   if(hEMA21 != INVALID_HANDLE) IndicatorRelease(hEMA21);
   if(hATR   != INVALID_HANDLE) IndicatorRelease(hATR);
   ObjectsDeleteAll(0, DASH_PREFIX);
   ChartRedraw();
  }

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
//| Strong candle: body > 40% of total range (filter weak dojis)    |
//+------------------------------------------------------------------+
bool StrongBullCandle(const double open1, const double close1,
                      const double high1, const double low1)
  {
   double body  = close1 - open1;
   double range = high1  - low1;
   if(range < 1e-10) return false;
   return (body > 0.0 && body / range >= 0.4);
  }

bool StrongBearCandle(const double open1, const double close1,
                      const double high1, const double low1)
  {
   double body  = open1  - close1;
   double range = high1  - low1;
   if(range < 1e-10) return false;
   return (body > 0.0 && body / range >= 0.4);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   LoadSettings();

   double rsi[], ema9[], ema21[], atr[];
   double open1[], high1[], low1[], close1[];
   ArraySetAsSeries(rsi,    true);
   ArraySetAsSeries(ema9,   true);
   ArraySetAsSeries(ema21,  true);
   ArraySetAsSeries(atr,    true);
   ArraySetAsSeries(open1,  true);
   ArraySetAsSeries(high1,  true);
   ArraySetAsSeries(low1,   true);
   ArraySetAsSeries(close1, true);

   if(CopyBuffer(hRSI,   0, 0, 3, rsi)    < 3) return;
   if(CopyBuffer(hEMA9,  0, 0, 3, ema9)   < 3) return;
   if(CopyBuffer(hEMA21, 0, 0, 3, ema21)  < 3) return;
   if(CopyBuffer(hATR,   0, 0, 2, atr)    < 2) return;
   if(CopyOpen  (_Symbol, TF, 0, 3, open1)  < 3) return;
   if(CopyHigh  (_Symbol, TF, 0, 3, high1)  < 3) return;
   if(CopyLow   (_Symbol, TF, 0, 3, low1)   < 3) return;
   if(CopyClose (_Symbol, TF, 0, 3, close1) < 3) return;

   double curRSI = rsi[0];
   double curATR = atr[0];

   // EMA trend on current bar
   bool emaUp   = ema9[0] > ema21[0];
   bool emaDown = ema9[0] < ema21[0];

   // EMA9/21 crossover (bar[1] to bar[0])
   bool crossUp = (ema9[1] <= ema21[1] && ema9[0] > ema21[0]);
   bool crossDn = (ema9[1] >= ema21[1] && ema9[0] < ema21[0]);

   // Candle quality on the last completed bar (index 1)
   bool bullBar = StrongBullCandle(open1[1], close1[1], high1[1], low1[1]);
   bool bearBar = StrongBearCandle(open1[1], close1[1], high1[1], low1[1]);

   //--- manage open positions
   ManagePositions(curRSI, crossUp, crossDn, curATR);

   //--- entry: crossover OR trend + candle confirmation
   //    BUY:  (EMA cross up OR emaUp) AND RSI 40-78 AND strong bull bar last candle
   //    SELL: (EMA cross dn OR emaDown) AND RSI 22-60 AND strong bear bar last candle
   string signal = "NONE";
   if((crossUp || emaUp) && curRSI >= 40.0 && curRSI <= 78.0 && bullBar)
      signal = "BUY";
   else if((crossDn || emaDown) && curRSI >= 22.0 && curRSI <= 60.0 && bearBar)
      signal = "SELL";

   //--- filters
   long spread     = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   bool spreadOK   = (spread <= (long)g_maxSpread);
   bool cooldownOK = (TimeCurrent() - g_lastEntryTime >= g_cooldownSecs);
   bool slotsOK    = (CountMyPositions() < g_maxPositions);
   bool sessionOK  = InTradingSession();

   bool allOK = spreadOK && cooldownOK && slotsOK && sessionOK && curATR > 0.0;

   if(signal != "NONE" && allOK)
     {
      if(signal == "BUY")
         OpenTrade(ORDER_TYPE_BUY, curATR);
      else
         OpenTrade(ORDER_TYPE_SELL, curATR);
     }

   UpdateDashboard(emaUp, emaDown, curRSI, signal, spreadOK && cooldownOK && slotsOK && sessionOK);
  }

//+------------------------------------------------------------------+
void OpenTrade(const ENUM_ORDER_TYPE type, const double atrVal)
  {
   double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long   freezeLevel= SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minDist = MathMax((double)(stopsLevel + freezeLevel + 5), 10.0) * point;

   // SL = 1.5x ATR, TP = 2.0x ATR (RR 1:1.33) — gold-tuned
   double slDist = MathMax(atrVal * 1.5, minDist);
   double tpDist = MathMax(atrVal * 2.0, minDist * 1.5);

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
      Print(EA_NAME, ": ", EnumToString(type), " lot=", lot,
            " sl=", sl, " tp=", tp, " atr=", DoubleToString(atrVal, 5));
     }
   else
      Print(EA_NAME, ": open failed retcode=", trade.ResultRetcode(),
            " comment=", trade.ResultComment());
  }

//+------------------------------------------------------------------+
double NormalizeLot(double lot)
  {
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(lotStep > 0.0)
      lot = MathFloor(lot / lotStep) * lotStep;
   return MathMax(minLot, MathMin(maxLot, lot));
  }

//+------------------------------------------------------------------+
void ManagePositions(const double curRSI, const bool crossUp,
                     const bool crossDn, const double atrVal)
  {
   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = MathMax((double)(stopsLevel + 5), 10.0) * point;
   double trail   = MathMax(atrVal * 1.0, minDist);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol() != _Symbol || posInfo.Magic() != g_magic) continue;

      ulong  ticket    = posInfo.Ticket();
      double openPrice = posInfo.PriceOpen();
      double curPrice  = posInfo.PriceCurrent();
      double sl        = posInfo.StopLoss();
      double tp        = posInfo.TakeProfit();

      if(posInfo.PositionType() == POSITION_TYPE_BUY)
        {
         double gain = curPrice - openPrice;
         if(curRSI > 78.0 || crossDn || (atrVal > 0.0 && gain >= atrVal * 2.0))
           { trade.PositionClose(ticket); continue; }
         if(atrVal > 0.0 && gain > trail)
           {
            double newSL = NormalizeDouble(curPrice - trail, digits);
            if(newSL > sl + point && curPrice - newSL >= minDist)
               trade.PositionModify(ticket, newSL, tp);
           }
        }
      else
        {
         double gain = openPrice - curPrice;
         if(curRSI < 22.0 || crossUp || (atrVal > 0.0 && gain >= atrVal * 2.0))
           { trade.PositionClose(ticket); continue; }
         if(atrVal > 0.0 && gain > trail)
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
   ObjectSetInteger(0, bg, OBJPROP_XSIZE,       260);
   ObjectSetInteger(0, bg, OBJPROP_YSIZE,       215);
   ObjectSetInteger(0, bg, OBJPROP_BGCOLOR,     C'15,15,25');
   ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, bg, OBJPROP_COLOR,       clrDimGray);
   ObjectSetInteger(0, bg, OBJPROP_BACK,        false);
   ObjectSetInteger(0, bg, OBJPROP_SELECTABLE,  false);
   ObjectSetInteger(0, bg, OBJPROP_HIDDEN,      true);

   string labels[10] = {"TITLE","MAGIC","TREND","RSI","SESSION","SIGNAL","ENTRY","POS","PL","TRADES"};
   for(int i = 0; i < 10; i++)
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
   string trend  = emaUp ? "UP" : (emaDown ? "DOWN" : "FLAT");
   color  trClr  = emaUp ? clrLime : (emaDown ? clrOrangeRed : clrSilver);
   bool   inSess = InTradingSession();

   int    posCount = CountMyPositions();
   double floatPL  = MyFloatingPL();
   long   cdLeft   = (long)g_cooldownSecs - (long)(TimeCurrent() - g_lastEntryTime);

   SetLabel("TITLE",   EA_NAME + " v" + EA_VERSION + "  " + _Symbol, clrGold);
   SetLabel("MAGIC",   "Magic   : " + (string)g_magic, clrSilver);
   SetLabel("TREND",   "Trend   : " + trend, trClr);
   SetLabel("RSI",     "RSI(7)  : " + DoubleToString(rsiVal, 2), clrDeepSkyBlue);
   SetLabel("SESSION", "Session : " + (inSess ? "ACTIVE" : "CLOSED"), inSess ? clrLime : clrDimGray);
   SetLabel("SIGNAL",  "Signal  : " + signal,
            signal == "BUY" ? clrLime : (signal == "SELL" ? clrOrangeRed : clrSilver));
   SetLabel("ENTRY",   "Entry   : " + (ready ? "READY" :
            (cdLeft > 0 ? "COOLDOWN " + (string)cdLeft + "s" : "BLOCKED")),
            ready ? clrLime : clrYellow);
   SetLabel("POS",     "Open Pos: " + (string)posCount + " / " + (string)g_maxPositions, clrWhite);
   SetLabel("PL",      "Float PL: " + DoubleToString(floatPL, 2),
            floatPL >= 0.0 ? clrLime : clrOrangeRed);
   SetLabel("TRADES",  "Trades  : " + (string)g_totalTrades, clrSilver);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
