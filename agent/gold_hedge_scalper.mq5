//+------------------------------------------------------------------+
//|                                         GoldHedgeScalper v1.00  |
//|          Scalping + Hedging Basket — Separate from GoldScalperX  |
//+------------------------------------------------------------------+
#property copyright "GHS"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- inputs (fallbacks only — real values come from settings file)
input double          BaseLot      = 0.01;
input ENUM_TIMEFRAMES TF           = PERIOD_M1;
input int             MagicNumber  = 77777;

//--- constants
#define EA_NAME        "GoldHedgeX"
#define EA_VERSION     "1.00"
#define SETTINGS_FILE  "GSX_Hedge.json"
#define LOG_FILE       "GSX_Hedge_Log.txt"
#define DASH_PREFIX    "GHX_D_"

//--- panel layout
#define PANEL_X   10
#define PANEL_Y   10
#define ROW_H     16
#define CLR_KEY   clrSilver
#define CLR_VAL   clrWhite

//=== SETTINGS (read from file each cycle) ==========================
double g_baseLot       = 0.01;
double g_lotMult       = 1.5;
double g_hedgeDistUSD  = 3.0;   // floating loss per position before hedge
double g_basketTP      = 2.0;   // net USD profit → close all
double g_maxDrawdown   = 50.0;  // net USD loss  → emergency close
int    g_maxLevels     = 4;
double g_maxSpread     = 350.0;
bool   g_botRunning    = true;
int    g_magic         = MagicNumber;

//=== STATE =========================================================
datetime g_lastBar     = 0;
string   g_lastHash    = "";
datetime g_lastEntryTime = 0;

//=== OBJECTS =======================================================
CTrade trade;

//===================================================================
//  UTILITY
//===================================================================

void EALog(string msg)
  {
   Print(EA_NAME, ": ", msg);
   int fh = FileOpen(LOG_FILE, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_COMMON);
   if(fh != INVALID_HANDLE)
     {
      FileSeek(fh, 0, SEEK_END);
      FileWriteString(fh, TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "|" + msg + "\n");
      FileClose(fh);
     }
  }

//--- read a numeric value from SETTINGS_FILE (JSON key: value)
double ReadSetting(const string name, const double fallback)
  {
   string fname = SETTINGS_FILE;
   int fh = FileOpen(fname, FILE_READ|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return fallback;
   string content = "";
   while(!FileIsEnding(fh)) content += FileReadString(fh);
   FileClose(fh);
   string key = "\"" + name + "\"";
   int p = StringFind(content, key);
   if(p < 0) return fallback;
   int colon = StringFind(content, ":", p);
   if(colon < 0) return fallback;
   string rest = StringSubstr(content, colon+1, 30);
   StringTrimLeft(rest); StringTrimRight(rest);
   double v = StringToDouble(rest);
   return v;
  }

//--- load / reload settings, return true if changed
bool LoadSettings()
  {
   double bLot  = ReadSetting("BaseLot",        0.01);
   double mult  = ReadSetting("LotMultiplier",  1.5);
   double hDist = ReadSetting("HedgeDistUSD",   3.0);
   double bTP   = ReadSetting("BasketTP",        2.0);
   double mDD   = ReadSetting("MaxDrawdown",    50.0);
   int    mLvl  = (int)ReadSetting("MaxLevels",  4.0);
   double mSprd = ReadSetting("MaxSpread",      350.0);
   bool   botOn = (ReadSetting("BotRunning",    1.0) > 0.5);

   string hash = DoubleToString(bLot,3)+DoubleToString(mult,2)
               + DoubleToString(hDist,2)+DoubleToString(bTP,2)
               + DoubleToString(mDD,1)+IntegerToString(mLvl)
               + DoubleToString(mSprd,0)+(botOn?"1":"0");
   bool changed = (hash != g_lastHash);
   g_lastHash = hash;

   g_baseLot      = MathMax(0.01, bLot);
   g_lotMult      = MathMax(1.1,  mult);
   g_hedgeDistUSD = MathMax(0.5,  hDist);
   g_basketTP     = MathMax(0.1,  bTP);
   g_maxDrawdown  = MathMax(5.0,  mDD);
   g_maxLevels    = MathMax(1,    mLvl);
   g_maxSpread    = mSprd;
   g_botRunning   = botOn;

   if(changed)
      EALog("Settings loaded — BaseLot="+DoubleToString(g_baseLot,2)
            +" Mult="+DoubleToString(g_lotMult,2)
            +" HedgeDist=$"+DoubleToString(g_hedgeDistUSD,2)
            +" BasketTP=$"+DoubleToString(g_basketTP,2)
            +" MaxDD=$"+DoubleToString(g_maxDrawdown,1)
            +" MaxLvl="+IntegerToString(g_maxLevels));
   return changed;
  }

//--- write default settings file if missing
void WriteDefaultSettings()
  {
   // delete old multi-line file if exists, rewrite as single line
   FileDelete(SETTINGS_FILE, FILE_COMMON);
   int fh = FileOpen(SETTINGS_FILE, FILE_READ|FILE_ANSI|FILE_COMMON);
   if(fh != INVALID_HANDLE) { FileClose(fh); return; } // already exists
   fh = FileOpen(SETTINGS_FILE, FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return;
   // single line JSON — ReadSetting() reads one line at a time
   string j = "{\"BaseLot\": 0.01, \"LotMultiplier\": 1.5, \"HedgeDistUSD\": 3.0, \"BasketTP\": 2.0, \"MaxDrawdown\": 50.0, \"MaxLevels\": 4, \"MaxSpread\": 350, \"BotRunning\": 1}";
   FileWriteString(fh, j);
   FileClose(fh);
   EALog("Default settings written to "+SETTINGS_FILE);
  }

//===================================================================
//  POSITION HELPERS
//===================================================================

//--- count positions with our magic
int CountBasket()
  {
   int n = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL)  != _Symbol)  continue;
      if(PositionGetInteger(POSITION_MAGIC)  != g_magic)  continue;
      n++;
     }
   return n;
  }

//--- net floating profit of entire basket (USD)
double BasketProfit()
  {
   double total = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)  continue;
      if(PositionGetInteger(POSITION_MAGIC) != g_magic)  continue;
      total += PositionGetDouble(POSITION_PROFIT)
             + PositionGetDouble(POSITION_SWAP);
     }
   return total;
  }

//--- last opened lot size in basket
double LastBasketLot()
  {
   double lot = g_baseLot;
   datetime latest = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)  continue;
      if(PositionGetInteger(POSITION_MAGIC) != g_magic)  continue;
      datetime t = (datetime)PositionGetInteger(POSITION_TIME);
      if(t >= latest) { latest = t; lot = PositionGetDouble(POSITION_VOLUME); }
     }
   return lot;
  }

//--- direction of first (oldest) position in basket
int BasketDirection()
  {
   datetime oldest = (datetime)INT_MAX;
   int dir = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)  continue;
      if(PositionGetInteger(POSITION_MAGIC) != g_magic)  continue;
      datetime t = (datetime)PositionGetInteger(POSITION_TIME);
      if(t < oldest)
        {
         oldest = t;
         dir = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
        }
     }
   return dir;
  }

//--- close all basket positions
void CloseBasket(string reason)
  {
   EALog("CLOSE BASKET ["+reason+"] net=$"+DoubleToString(BasketProfit(),2));
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)  continue;
      if(PositionGetInteger(POSITION_MAGIC) != g_magic)  continue;
      trade.PositionClose(ticket, (ulong)(g_maxSpread*2));
      Sleep(100);
     }
  }

//--- total lots of entire basket
double TotalBasketLots()
  {
   double total = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)  continue;
      if(PositionGetInteger(POSITION_MAGIC) != g_magic)  continue;
      total += PositionGetDouble(POSITION_VOLUME);
     }
   return total;
  }

//--- dynamic basket TP: g_basketTP per g_baseLot of total lots
double DynamicBasketTP()
  {
   double totalLots = TotalBasketLots();
   if(totalLots <= 0) return g_basketTP;
   return g_basketTP * (totalLots / g_baseLot);
  }

//--- normalize lot
double NormLot(double lot)
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   lot = MathFloor(lot / step) * step;
   return MathMax(minL, MathMin(maxL, lot));
  }

//===================================================================
//  DASHBOARD
//===================================================================

void DLabel(string id, string txt, int x, int y, color clr, int sz=9)
  {
   string n = DASH_PREFIX + id;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetString(0, n, OBJPROP_FONT, "Courier New");
      ObjectSetInteger(0, n, OBJPROP_BACK, false);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
     }
   ObjectSetString(0, n, OBJPROP_TEXT, txt);
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, n, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, sz);
  }

void UpdateDashboard(int basketSize, double netProfit, int level, double dynTP=0)
  {
   int xK = PANEL_X, xV = PANEL_X + 90;
   int y  = PANEL_Y;

   DLabel("TITLE", EA_NAME + " v" + EA_VERSION + "  " + _Symbol, xK, y, clrGold, 10); y += ROW_H + 4;

   DLabel("K_BASKET", "BASKET",  xK, y, CLR_KEY);
   DLabel("V_BASKET", IntegerToString(basketSize)+" pos", xV, y,
          basketSize > 0 ? clrYellow : clrGray); y += ROW_H;

   DLabel("K_LEVEL",  "LEVEL",   xK, y, CLR_KEY);
   DLabel("V_LEVEL",  IntegerToString(level)+"/"+IntegerToString(g_maxLevels),
          xV, y, level >= g_maxLevels ? clrRed : clrWhite); y += ROW_H;

   DLabel("K_NET",    "NET P/L", xK, y, CLR_KEY);
   color nc = netProfit >= 0 ? clrLime : clrRed;
   DLabel("V_NET",    "$"+DoubleToString(netProfit, 2), xV, y, nc); y += ROW_H;

   DLabel("K_TP",     "BASKET TP", xK, y, CLR_KEY);
   string tpStr = dynTP > 0 ? "$"+DoubleToString(dynTP,2)+" (x"+DoubleToString(dynTP/g_basketTP,1)+")" : "$"+DoubleToString(g_basketTP,2);
   DLabel("V_TP",     tpStr, xV, y, clrCyan); y += ROW_H;

   DLabel("K_HD",     "HEDGE DIST", xK, y, CLR_KEY);
   DLabel("V_HD",     "$"+DoubleToString(g_hedgeDistUSD, 2), xV, y, clrCyan); y += ROW_H;

   DLabel("K_MULT",   "LOT MULT",  xK, y, CLR_KEY);
   DLabel("V_MULT",   DoubleToString(g_lotMult, 2)+"x", xV, y, clrCyan); y += ROW_H;

   DLabel("K_BOT",    "BOT",    xK, y, CLR_KEY);
   DLabel("V_BOT",    g_botRunning ? "ON" : "OFF",
          xV, y, g_botRunning ? clrLime : clrRed); y += ROW_H;

   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   DLabel("K_SPR",    "SPREAD",  xK, y, CLR_KEY);
   color sc = spread > g_maxSpread ? clrRed : clrGray;
   DLabel("V_SPR",    IntegerToString(spread), xV, y, sc);

   ChartRedraw(0);
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
   EALog("Init — " + EA_NAME + " v" + EA_VERSION);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, DASH_PREFIX);
   EALog("Deinit reason=" + IntegerToString(reason));
  }

void OnTick()
  {
   LoadSettings();

   int basket = CountBasket();
   double net = BasketProfit();
   double dynTP = DynamicBasketTP();

   // ── BASKET TP (dynamic) ───────────────────────────────────────
   if(basket > 0 && net >= dynTP)
     {
      CloseBasket("TP $"+DoubleToString(net,2)+" (target $"+DoubleToString(dynTP,2)+")");
      UpdateDashboard(0, 0, 0);
      return;
     }

   // ── EMERGENCY CLOSE (max drawdown) ───────────────────────────
   if(basket > 0 && net <= -g_maxDrawdown)
     {
      EALog("⚠ EMERGENCY CLOSE drawdown=$"+DoubleToString(net,2));
      CloseBasket("MAXDD");
      UpdateDashboard(0, 0, 0);
      return;
     }

   UpdateDashboard(basket, net, basket, dynTP);

   if(!g_botRunning) return;

   // ── SPREAD CHECK ─────────────────────────────────────────────
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > g_maxSpread) return;

   // ── MAX LEVELS REACHED — wait for TP or emergency only ───────
   if(basket >= g_maxLevels) return;

   // ── BAR GATE ─────────────────────────────────────────────────
   datetime barTime = iTime(_Symbol, TF, 0);
   if(barTime == g_lastBar) return;
   g_lastBar = barTime;

   // ── HEDGE CHECK (new bar, basket open) ───────────────────────
   if(basket > 0)
      CheckHedge();

   // ── ENTRY: add to basket in same direction OR open new basket ─
   TryEntry(basket);
  }

//===================================================================
//  ENTRY SIGNAL — momentum candle
//===================================================================

void TryEntry(int currentBasket)
  {
   int hATR = iATR(_Symbol, TF, 14);
   if(hATR == INVALID_HANDLE) return;
   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(hATR, 0, 0, 3, atr) < 3) { IndicatorRelease(hATR); return; }
   IndicatorRelease(hATR);

   double o[], h[], l[], c[];
   ArraySetAsSeries(o,true); ArraySetAsSeries(h,true);
   ArraySetAsSeries(l,true); ArraySetAsSeries(c,true);
   if(CopyOpen(_Symbol,TF,0,3,o)<3)  return;
   if(CopyHigh(_Symbol,TF,0,3,h)<3)  return;
   if(CopyLow(_Symbol,TF,0,3,l)<3)   return;
   if(CopyClose(_Symbol,TF,0,3,c)<3) return;

   double body  = MathAbs(c[1] - o[1]);
   double range = h[1] - l[1] + 1e-10;
   double atr1  = atr[1];

   bool bullBar = (c[1] > o[1]) && (body >= 0.35*atr1) && (body/range >= 0.30);
   bool bearBar = (c[1] < o[1]) && (body >= 0.35*atr1) && (body/range >= 0.30);

   // if basket is open, only add in SAME direction as basket
   if(currentBasket > 0)
     {
      int dir = BasketDirection(); // 1=buy basket, -1=sell basket
      if(dir == 1  && !bullBar) return; // basket is buy, wait for bull candle
      if(dir == -1 && !bearBar) return; // basket is sell, wait for bear candle
     }
   else
     {
      if(!bullBar && !bearBar) return; // no basket — need signal to open
     }

   double lot = NormLot(g_baseLot);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   string tag = currentBasket > 0 ? "GHX_ADD" : "GHX_ENTRY";

   if(bullBar || (currentBasket > 0 && BasketDirection() == 1))
     {
      if(trade.Buy(lot, _Symbol, ask, 0, 0, tag))
         EALog("BUY_"+tag+" #"+IntegerToString(currentBasket+1)+" lot="+DoubleToString(lot,2));
      else
         EALog("FAIL BUY_"+tag+" "+IntegerToString(trade.ResultRetcode())+" "+trade.ResultComment());
     }
   else
     {
      if(trade.Sell(lot, _Symbol, bid, 0, 0, tag))
         EALog("SELL_"+tag+" #"+IntegerToString(currentBasket+1)+" lot="+DoubleToString(lot,2));
      else
         EALog("FAIL SELL_"+tag+" "+IntegerToString(trade.ResultRetcode())+" "+trade.ResultComment());
     }
  }

//===================================================================
//  HEDGE CHECK — called every tick when basket is open
//===================================================================

void CheckHedge()
  {
   // find worst individual position loss
   double worstLoss = 0;
   int    worstType = -1;
   double lastLot   = g_baseLot;
   datetime latestTime = 0;

   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)  continue;
      if(PositionGetInteger(POSITION_MAGIC) != g_magic)  continue;

      double profit = PositionGetDouble(POSITION_PROFIT)
                    + PositionGetDouble(POSITION_SWAP);
      int    ptype  = (int)PositionGetInteger(POSITION_TYPE);
      datetime pt   = (datetime)PositionGetInteger(POSITION_TIME);

      if(profit < worstLoss) { worstLoss = profit; worstType = ptype; }
      if(pt >= latestTime)   { latestTime = pt; lastLot = PositionGetDouble(POSITION_VOLUME); }
     }

   // if worst position is losing more than hedgeDistUSD → open hedge
   if(worstLoss <= -g_hedgeDistUSD && worstType >= 0)
     {
      double newLot = NormLot(lastLot * g_lotMult);
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

      // hedge in OPPOSITE direction of worst loser
      if(worstType == POSITION_TYPE_BUY)
        {
         // worst is a buy → open sell hedge
         if(trade.Sell(newLot, _Symbol, bid, 0, 0, "GHX_HEDGE"))
            EALog("SELL_HEDGE lvl="+IntegerToString(CountBasket()+1)
                  +" lot="+DoubleToString(newLot,2)
                  +" trigger=$"+DoubleToString(worstLoss,2));
         else
            EALog("FAIL SELL_HEDGE "+IntegerToString(trade.ResultRetcode())+" "+trade.ResultComment());
        }
      else
        {
         // worst is a sell → open buy hedge
         if(trade.Buy(newLot, _Symbol, ask, 0, 0, "GHX_HEDGE"))
            EALog("BUY_HEDGE lvl="+IntegerToString(CountBasket()+1)
                  +" lot="+DoubleToString(newLot,2)
                  +" trigger=$"+DoubleToString(worstLoss,2));
         else
            EALog("FAIL BUY_HEDGE "+IntegerToString(trade.ResultRetcode())+" "+trade.ResultComment());
        }
     }
  }
//+------------------------------------------------------------------+
