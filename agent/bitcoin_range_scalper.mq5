//+------------------------------------------------------------------+
//|                                      BitcoinRangeScalper v1.00  |
//|          Range Scalping — SELL at resistance, BUY at support     |
//+------------------------------------------------------------------+
#property copyright "BRS"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

//--- inputs (fallbacks — real values from settings file)
input double          BaseLot       = 0.01;
input int             MagicNumber   = 77777;

//--- EA identity
#define EA_NAME        "BitcoinRangeX"
#define EA_VERSION     "1.00"
#define SETTINGS_FILE  "BRX_Settings.json"
#define LOG_FILE       "BRX_Log.txt"
#define DASH_PREFIX    "BRX_D_"
#define PANEL_X        10
#define PANEL_Y        230
#define ROW_H          16
#define CLR_KEY        clrSilver
#define CLR_VAL        clrWhite

CTrade trade;

//--- settings (loaded from file every bar)
double g_baseLot      = 0.01;
int    g_basketCount  = 3;
double g_basketTP     = 20.0;
double g_maxDrawdown  = 100.0;
double g_maxSpread    = 500.0;
double g_lotBoost     = 2.0;
double g_touchZonePct = 20.0;   // % من عرض الرانج = منطقة الدخول
int    g_rangePeriod  = 30;     // عدد الشمعات للرانج
bool   g_botRunning   = true;
int    g_magic        = MagicNumber;
string g_lastHash     = "";

//--- state
datetime g_lastBar   = 0;
double   g_rangeHigh = 0;
double   g_rangeLow  = 0;
bool     g_inEntry   = false;

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
   if(fh != INVALID_HANDLE) { FileClose(fh); return; }
   fh = FileOpen(SETTINGS_FILE, FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return;
   string j = "{\"BaseLot\": 0.01, \"BasketCount\": 3, \"BasketTP\": 20.0, \"MaxDrawdown\": 100.0, \"MaxSpread\": 500, \"LotBoost\": 2.0, \"TouchZonePct\": 20.0, \"RangePeriod\": 30, \"BotRunning\": 1}";
   FileWriteString(fh, j);
   FileClose(fh);
  }

void LoadSettings()
  {
   double bLot  = ReadSetting("BaseLot",       0.01);
   int    bCnt  = (int)ReadSetting("BasketCount",  3.0);
   double bTP   = ReadSetting("BasketTP",      20.0);
   double mDD   = ReadSetting("MaxDrawdown",  100.0);
   double mSprd = ReadSetting("MaxSpread",    500.0);
   double lBst  = ReadSetting("LotBoost",      2.0);
   double tZone = ReadSetting("TouchZonePct", 20.0);
   int    rPer  = (int)ReadSetting("RangePeriod", 30.0);
   bool   botOn = (ReadSetting("BotRunning",   1.0) > 0.5);

   string hash = DoubleToString(bLot,3)+IntegerToString(bCnt)
               + DoubleToString(bTP,2)+DoubleToString(mDD,1)
               + DoubleToString(mSprd,0)+DoubleToString(lBst,1)
               + DoubleToString(tZone,1)+IntegerToString(rPer)+(botOn?"1":"0");
   if(hash == g_lastHash) return;
   g_lastHash = hash;

   g_baseLot      = MathMax(0.001, bLot);
   g_basketCount  = MathMax(1,     bCnt);
   g_basketTP     = MathMax(1.0,   bTP);
   g_maxDrawdown  = MathMax(5.0,   mDD);
   g_maxSpread    = mSprd;
   g_lotBoost     = MathMax(1.0,   lBst);
   g_touchZonePct = MathMax(5.0,   MathMin(49.0, tZone));
   g_rangePeriod  = MathMax(5,     rPer);
   g_botRunning   = botOn;

   EALog("Settings — BaseLot="+DoubleToString(g_baseLot,3)
         +" BasketCnt="+IntegerToString(g_basketCount)
         +" TP=$"+DoubleToString(g_basketTP,2)
         +" TouchZone="+DoubleToString(g_touchZonePct,1)+"%"
         +" RangePeriod="+IntegerToString(g_rangePeriod));
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
  }

//===================================================================
//  DASHBOARD
//===================================================================

void UpdateDashboard(int basket, double net)
  {
   int x = PANEL_X, xV = PANEL_X + 100, y = PANEL_Y;

   DLabel("K_NAME", "⬦ BTC RANGE SCALPER", x, y, clrOrange); y += ROW_H;
   DLabel("K_RH",   "RANGE H",   x, y, CLR_KEY);
   DLabel("V_RH",   DoubleToString(g_rangeHigh,2), xV, y, clrAqua); y += ROW_H;
   DLabel("K_RL",   "RANGE L",   x, y, CLR_KEY);
   DLabel("V_RL",   DoubleToString(g_rangeLow,2),  xV, y, clrAqua); y += ROW_H;
   double rw = g_rangeHigh - g_rangeLow;
   DLabel("K_RW",   "RANGE W",   x, y, CLR_KEY);
   DLabel("V_RW",   DoubleToString(rw,2)+"$",      xV, y, clrSilver); y += ROW_H;
   DLabel("K_BSK",  "BASKET",    x, y, CLR_KEY);
   DLabel("V_BSK",  IntegerToString(basket),        xV, y, basket>0?clrLime:clrGray); y += ROW_H;
   DLabel("K_NET",  "NET P/L",   x, y, CLR_KEY);
   color nc = net > 0 ? clrLime : (net < 0 ? clrRed : clrGray);
   DLabel("V_NET",  "$"+DoubleToString(net,2),      xV, y, nc); y += ROW_H;
   DLabel("K_TP",   "BASKET TP", x, y, CLR_KEY);
   DLabel("V_TP",   "$"+DoubleToString(g_basketTP,2), xV, y, clrCyan); y += ROW_H;
   DLabel("K_BOT",  "BOT",       x, y, CLR_KEY);
   DLabel("V_BOT",  g_botRunning?"ON":"OFF",        xV, y, g_botRunning?clrLime:clrRed); y += ROW_H;
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   DLabel("K_SPR",  "SPREAD",    x, y, CLR_KEY);
   DLabel("V_SPR",  IntegerToString(spread),        xV, y, spread>g_maxSpread?clrRed:clrGray);
   ChartRedraw(0);
  }

//===================================================================
//  ENTRY LOGIC
//===================================================================

void TryEntry()
  {
   if(!g_botRunning) return;
   if(g_inEntry) return;
   if(CountBasket() > 0) return;

   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > g_maxSpread) return;

   double rangeWidth = g_rangeHigh - g_rangeLow;
   if(rangeWidth < 10.0) return; // رانج ضيق جداً — تجنب

   double touchZone = rangeWidth * (g_touchZonePct / 100.0);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   double distToHigh = g_rangeHigh - bid;
   double distToLow  = ask - g_rangeLow;

   bool sellSignal = (distToHigh <= touchZone && bid > g_rangeLow + touchZone);
   bool buySignal  = (distToLow  <= touchZone && ask < g_rangeHigh - touchZone);

   if(!sellSignal && !buySignal) return;

   // كلما اقتربنا من الحد كلما كبر اللوت
   double proximity = sellSignal
                    ? (1.0 - distToHigh / touchZone)
                    : (1.0 - distToLow  / touchZone);
   double lot = NormLot(g_baseLot * (proximity >= 0.5 ? g_lotBoost : 1.0));

   string dir = sellSignal ? "SELL" : "BUY";
   EALog("SIGNAL "+dir
         +" range="+DoubleToString(g_rangeLow,2)+"-"+DoubleToString(g_rangeHigh,2)
         +" zone="+DoubleToString(touchZone,2)
         +" prox="+DoubleToString(proximity*100,0)+"%"
         +" lot="+DoubleToString(lot,3));

   g_inEntry = true;
   int opened = 0;
   for(int i = 0; i < g_basketCount; i++)
     {
      bool ok = false;
      if(sellSignal)
         ok = trade.Sell(lot, _Symbol, SymbolInfoDouble(_Symbol,SYMBOL_BID), 0, 0, "BRX_SELL");
      else
         ok = trade.Buy (lot, _Symbol, SymbolInfoDouble(_Symbol,SYMBOL_ASK), 0, 0, "BRX_BUY");
      if(ok) opened++;
      else { EALog("FAIL "+dir+" #"+IntegerToString(i+1)); break; }
      Sleep(50);
     }
   EALog("BASKET OPENED "+IntegerToString(opened)+"/"+IntegerToString(g_basketCount)+" "+dir);
   g_inEntry = false;
  }

//===================================================================
//  EA EVENTS
//===================================================================

int OnInit()
  {
   trade.SetExpertMagicNumber(g_magic);
   trade.SetDeviationInPoints(50);
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

   // ── UPDATE RANGE ─────────────────────────────────────────────
   UpdateRange();

   // ── ENTRY ────────────────────────────────────────────────────
   TryEntry();
  }
//+------------------------------------------------------------------+
