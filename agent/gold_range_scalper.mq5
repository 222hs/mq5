//+------------------------------------------------------------------+
//|                                        GoldRangeScalper v1.00   |
//|          Range Scalping — SELL at resistance, BUY at support     |
//+------------------------------------------------------------------+
#property copyright "GRS"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

//--- inputs (fallbacks only — real values come from settings file)
input double          BaseLot       = 0.11;
input int             MagicNumber   = 88888;

//--- EA identity
#define EA_NAME        "GoldRangeX"
#define EA_VERSION     "1.00"
#define SETTINGS_FILE  "GRX_Settings.json"
#define LOG_FILE       "GRX_Log.txt"
#define DASH_PREFIX    "GRX_D_"
#define PANEL_X        10
#define PANEL_Y        230
#define ROW_H          16
#define CLR_KEY        clrSilver
#define CLR_VAL        clrWhite

CTrade trade;

//--- settings (loaded from file every bar)
double g_baseLot      = 0.11;
int    g_rangePeriod  = 30;
double g_touchZonePct = 20.0;
int    g_basketCount  = 5;
double g_basketTP     = 15.0;
double g_maxDrawdown  = 80.0;
double g_maxSpread    = 350.0;
double g_lotBoost     = 2.0;
bool   g_botRunning   = true;
int    g_magic        = MagicNumber;
string g_lastHash     = "";

//--- state
datetime g_lastBar   = 0;
double   g_rangeHigh = 0;
double   g_rangeLow  = 0;
double   g_rangeMid  = 0;

//===================================================================
//===================================================================
//  SETTINGS FILE
//===================================================================

double ReadSetting(string key, double def)
  {
   int fh = FileOpen(SETTINGS_FILE, FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return def;
   string raw = "";
   while(!FileIsEnding(fh)) raw += FileReadString(fh);
   FileClose(fh);
   string pat = "\"" + key + "\":";
   int pos = StringFind(raw, pat);
   if(pos < 0) return def;
   string rest = StringSubstr(raw, pos + StringLen(pat));
   StringTrimLeft(rest); StringTrimRight(rest);
   return StringToDouble(rest);
  }

void WriteDefaultSettings()
  {
   int fh = FileOpen(SETTINGS_FILE, FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh != INVALID_HANDLE) { FileClose(fh); return; } // already exists
   fh = FileOpen(SETTINGS_FILE, FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return;
   string j = "{\"BaseLot\": 0.11, \"RangePeriod\": 30, \"TouchZonePct\": 20.0, \"BasketCount\": 5, \"BasketTP\": 15.0, \"MaxDrawdown\": 80.0, \"MaxSpread\": 350, \"LotBoost\": 2.0, \"BotRunning\": 1}";
   FileWriteString(fh, j);
   FileClose(fh);
  }

void LoadSettings()
  {
   double bLot  = ReadSetting("BaseLot",      0.11);
   int    rPer  = (int)ReadSetting("RangePeriod", 30.0);
   double tZone = ReadSetting("TouchZonePct", 20.0);
   int    bCnt  = (int)ReadSetting("BasketCount",  5.0);
   double bTP   = ReadSetting("BasketTP",     15.0);
   double mDD   = ReadSetting("MaxDrawdown",  80.0);
   double mSprd = ReadSetting("MaxSpread",   350.0);
   double lBst  = ReadSetting("LotBoost",     2.0);
   bool   botOn = (ReadSetting("BotRunning",  1.0) > 0.5);

   string hash = DoubleToString(bLot,3)+IntegerToString(rPer)
               + DoubleToString(tZone,1)+IntegerToString(bCnt)
               + DoubleToString(bTP,2)+DoubleToString(mDD,1)
               + DoubleToString(mSprd,0)+DoubleToString(lBst,1)+(botOn?"1":"0");
   if(hash == g_lastHash) return;
   g_lastHash = hash;

   g_baseLot      = MathMax(0.01, bLot);
   g_rangePeriod  = MathMax(5,    rPer);
   g_touchZonePct = MathMax(1.0,  tZone);
   g_basketCount  = MathMax(1,    bCnt);
   g_basketTP     = MathMax(0.5,  bTP);
   g_maxDrawdown  = MathMax(5.0,  mDD);
   g_maxSpread    = mSprd;
   g_lotBoost     = MathMax(1.0,  lBst);
   g_botRunning   = botOn;

   EALog("Settings — BaseLot="+DoubleToString(g_baseLot,2)
         +" Range="+IntegerToString(g_rangePeriod)
         +" TouchZone="+DoubleToString(g_touchZonePct,1)+"%"
         +" BasketCnt="+IntegerToString(g_basketCount)
         +" BasketTP=$"+DoubleToString(g_basketTP,2)
         +" MaxDD=$"+DoubleToString(g_maxDrawdown,1)
         +" LotBoost="+DoubleToString(g_lotBoost,1)+"x");
  }

//===================================================================
void EALog(string msg)
  {
   string line = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS)
               + " " + EA_NAME + ": " + msg;
   Print(line);
   int fh = FileOpen(LOG_FILE, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh != INVALID_HANDLE)
     {
      FileSeek(fh, 0, SEEK_END);
      FileWriteString(fh, line + "\n");
      FileClose(fh);
     }
  }

//--- dashboard label
void DLabel(string name, string txt, int x, int y, color clr)
  {
   string n = DASH_PREFIX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_FONTSIZE, 8);
      ObjectSetString(0, n, OBJPROP_FONT, "Courier New");
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
     }
   ObjectSetString(0, n, OBJPROP_TEXT, txt);
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, n, OBJPROP_COLOR, clr);
  }

//===================================================================
//  BASKET MANAGEMENT
//===================================================================

int CountBasket()
  {
   int n = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != g_magic) continue;
      n++;
     }
   return n;
  }

double BasketProfit()
  {
   double total = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != g_magic) continue;
      total += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
     }
   return total;
  }

void CloseBasket(string reason)
  {
   EALog("CLOSE ["+reason+"] net=$"+DoubleToString(BasketProfit(),2));
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != g_magic) continue;
      trade.PositionClose(t, (ulong)(g_maxSpread*2));
      Sleep(80);
     }
  }

double NormLot(double lot)
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   lot = MathFloor(lot / step) * step;
   return MathMax(minL, MathMin(maxL, lot));
  }

//===================================================================
//  RANGE DETECTION
//===================================================================

void UpdateRange()
  {
   double hi[], lo[];
   ArraySetAsSeries(hi, true);
   ArraySetAsSeries(lo, true);
   if(CopyHigh(_Symbol, PERIOD_M5, 1, g_rangePeriod, hi) < g_rangePeriod) return;
   if(CopyLow (_Symbol, PERIOD_M5, 1, g_rangePeriod, lo) < g_rangePeriod) return;

   g_rangeHigh = hi[ArrayMaximum(hi, 0, g_rangePeriod)];
   g_rangeLow  = lo[ArrayMinimum(lo, 0, g_rangePeriod)];
   g_rangeMid  = (g_rangeHigh + g_rangeLow) / 2.0;
  }

//===================================================================
//  DASHBOARD
//===================================================================

void UpdateDashboard(int basket, double net)
  {
   int x = PANEL_X, xV = PANEL_X + 90, y = PANEL_Y;

   DLabel("K_NAME", "⬦ RANGE SCALPER", x, y, clrGold); y += ROW_H;
   DLabel("K_RH",   "RANGE H",  x, y, CLR_KEY);
   DLabel("V_RH",   DoubleToString(g_rangeHigh,2), xV, y, clrAqua); y += ROW_H;
   DLabel("K_RL",   "RANGE L",  x, y, CLR_KEY);
   DLabel("V_RL",   DoubleToString(g_rangeLow,2),  xV, y, clrAqua); y += ROW_H;
   DLabel("K_BSK",  "BASKET",   x, y, CLR_KEY);
   DLabel("V_BSK",  IntegerToString(basket),        xV, y, basket>0?clrLime:clrGray); y += ROW_H;
   DLabel("K_NET",  "NET P/L",  x, y, CLR_KEY);
   color nc = net > 0 ? clrLime : (net < 0 ? clrRed : clrGray);
   DLabel("V_NET",  "$"+DoubleToString(net,2),      xV, y, nc); y += ROW_H;
   DLabel("K_TP",   "BASKET TP",x, y, CLR_KEY);
   DLabel("V_TP",   "$"+DoubleToString(g_basketTP,2), xV, y, clrCyan); y += ROW_H;
   DLabel("K_BOT",  "BOT",      x, y, CLR_KEY);
   DLabel("V_BOT",  g_botRunning?"ON":"OFF",        xV, y, g_botRunning?clrLime:clrRed); y += ROW_H;
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   DLabel("K_SPR",  "SPREAD",   x, y, CLR_KEY);
   DLabel("V_SPR",  IntegerToString(spread),        xV, y, spread>MaxSpread?clrRed:clrGray);
   ChartRedraw(0);
  }

//===================================================================
//  ENTRY LOGIC
//===================================================================

void TryEntry()
  {
   if(!g_botRunning) return;
   if(CountBasket() > 0) return;   // wait for basket to close before new entry

   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > g_maxSpread) return;

   double rangeWidth = g_rangeHigh - g_rangeLow;
   if(rangeWidth < 1.0) return; // range too narrow, skip

   double touchZone = rangeWidth * (g_touchZonePct / 100.0);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   // how close to boundary as a fraction (0=at boundary, 1=at midpoint)
   double distToHigh = g_rangeHigh - bid;
   double distToLow  = ask - g_rangeLow;

   bool sellSignal = (distToHigh <= touchZone); // price near top → SELL
   bool buySignal  = (distToLow  <= touchZone); // price near bottom → BUY

   if(!sellSignal && !buySignal) return;

   // boost lot when very close to boundary (within 50% of touch zone)
   double proximity = sellSignal
                    ? (1.0 - distToHigh / touchZone)
                    : (1.0 - distToLow  / touchZone);
   double lot = NormLot(g_baseLot * (proximity >= 0.5 ? g_lotBoost : 1.0));

   string dir = sellSignal ? "SELL" : "BUY";
   EALog("SIGNAL "+dir+" range="+DoubleToString(g_rangeLow,2)+"-"+DoubleToString(g_rangeHigh,2)
         +" zone="+DoubleToString(touchZone,2)+" lot="+DoubleToString(lot,2)
         +" proximity="+DoubleToString(proximity*100,0)+"%");

   int opened = 0;
   for(int i = 0; i < g_basketCount; i++)
     {
      bool ok = false;
      if(sellSignal)
         ok = trade.Sell(lot, _Symbol, SymbolInfoDouble(_Symbol,SYMBOL_BID), 0, 0, "GRX_SELL");
      else
         ok = trade.Buy (lot, _Symbol, SymbolInfoDouble(_Symbol,SYMBOL_ASK), 0, 0, "GRX_BUY");

      if(ok) opened++;
      else
        {
         EALog("FAIL "+dir+" #"+IntegerToString(i+1)+" "+IntegerToString(trade.ResultRetcode()));
         break;
        }
      Sleep(50);
     }
   EALog("OPENED "+IntegerToString(opened)+" x "+dir+" "+DoubleToString(lot,2)+" lot");
  }

//===================================================================
//  EA EVENTS
//===================================================================

int OnInit()
  {
   trade.SetExpertMagicNumber(g_magic);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFilling(ORDER_FILLING_IOC);
   WriteDefaultSettings();
   LoadSettings();
   UpdateRange();
   EALog("Init — "+EA_NAME+" v"+EA_VERSION
         +" range="+DoubleToString(g_rangeLow,2)+"-"+DoubleToString(g_rangeHigh,2));
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, DASH_PREFIX);
   EALog("Deinit reason="+IntegerToString(reason));
  }

void OnTick()
  {
   LoadSettings();
   int    basket = CountBasket();
   double net    = BasketProfit();

   // ── BASKET TP ────────────────────────────────────────────────
   if(basket > 0 && net >= g_basketTP)
     {
      CloseBasket("TP $"+DoubleToString(net,2));
      UpdateDashboard(0, 0);
      return;
     }

   // ── EMERGENCY CLOSE ──────────────────────────────────────────
   if(basket > 0 && net <= -g_maxDrawdown)
     {
      CloseBasket("MAXDD $"+DoubleToString(net,2));
      UpdateDashboard(0, 0);
      return;
     }

   UpdateDashboard(basket, net);

   // ── BAR GATE ─────────────────────────────────────────────────
   datetime barTime = iTime(_Symbol, PERIOD_M1, 0);
   if(barTime == g_lastBar) return;
   g_lastBar = barTime;

   // ── UPDATE RANGE (every new bar) ─────────────────────────────
   UpdateRange();

   // ── ENTRY ────────────────────────────────────────────────────
   TryEntry();
  }
//+------------------------------------------------------------------+
