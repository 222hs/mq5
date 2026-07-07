//+------------------------------------------------------------------+
//|                                        GoldRangeScalper v1.00   |
//|          Range Scalping — SELL at resistance, BUY at support     |
//+------------------------------------------------------------------+
#property copyright "GRS"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

//--- inputs
input double          BaseLot       = 0.11;
input int             MagicNumber   = 88888;
input ENUM_TIMEFRAMES TF_RANGE      = PERIOD_M5;  // timeframe for range detection
input int             RangePeriod   = 30;          // candles to look back for range
input double          TouchZonePct  = 20.0;        // % of range width = touch zone
input int             BasketCount   = 5;           // positions per signal
input double          BasketTP      = 15.0;        // USD profit to close basket
input double          MaxDrawdown   = 80.0;        // USD loss emergency close
input double          MaxSpread     = 350.0;
input double          LotBoost      = 2.0;         // lot multiplier at strong level

//--- EA identity
#define EA_NAME       "GoldRangeX"
#define EA_VERSION    "1.00"
#define LOG_FILE      "GRX_Log.txt"
#define DASH_PREFIX   "GRX_D_"
#define PANEL_X       10
#define PANEL_Y       230
#define ROW_H         16
#define CLR_KEY       clrSilver
#define CLR_VAL       clrWhite

CTrade trade;

//--- state
datetime g_lastBar      = 0;
double   g_rangeHigh    = 0;
double   g_rangeLow     = 0;
double   g_rangeMid     = 0;
bool     g_botRunning   = true;
int      g_magic        = MagicNumber;

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
      trade.PositionClose(t, (ulong)(MaxSpread*2));
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
   if(CopyHigh(_Symbol, TF_RANGE, 1, RangePeriod, hi) < RangePeriod) return;
   if(CopyLow (_Symbol, TF_RANGE, 1, RangePeriod, lo) < RangePeriod) return;

   g_rangeHigh = hi[ArrayMaximum(hi, 0, RangePeriod)];
   g_rangeLow  = lo[ArrayMinimum(lo, 0, RangePeriod)];
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
   DLabel("V_TP",   "$"+DoubleToString(BasketTP,2), xV, y, clrCyan); y += ROW_H;
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
   if(spread > MaxSpread) return;

   double rangeWidth = g_rangeHigh - g_rangeLow;
   if(rangeWidth < 1.0) return; // range too narrow, skip

   double touchZone = rangeWidth * (TouchZonePct / 100.0);
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
   double lot = NormLot(BaseLot * (proximity >= 0.5 ? LotBoost : 1.0));

   string dir = sellSignal ? "SELL" : "BUY";
   EALog("SIGNAL "+dir+" range="+DoubleToString(g_rangeLow,2)+"-"+DoubleToString(g_rangeHigh,2)
         +" zone="+DoubleToString(touchZone,2)+" lot="+DoubleToString(lot,2)
         +" proximity="+DoubleToString(proximity*100,0)+"%");

   int opened = 0;
   for(int i = 0; i < BasketCount; i++)
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
   int    basket = CountBasket();
   double net    = BasketProfit();

   // ── BASKET TP ────────────────────────────────────────────────
   if(basket > 0 && net >= BasketTP)
     {
      CloseBasket("TP $"+DoubleToString(net,2));
      UpdateDashboard(0, 0);
      return;
     }

   // ── EMERGENCY CLOSE ──────────────────────────────────────────
   if(basket > 0 && net <= -MaxDrawdown)
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
