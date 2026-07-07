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
#define SAFETY_SL_MULT 4.0   // SL أمان = ATR × SLMult × SAFETY_SL_MULT (واسع — يمنع خسارة كبيرة فقط)

CTrade trade;

//--- settings (loaded from file every bar)
double g_baseLot      = 0.11;
double g_riskPct      = 1.0;
double g_basketTP     = 15.0;
int    g_basketCount  = 5;
double g_maxDrawdown  = 80.0;
double g_maxSpread    = 350.0;
double g_lotBoost     = 2.0;
int    g_cooldownBars = 3;
double g_adxMax       = 25.0;
bool   g_useADXFilter = true;
double g_slMult       = 1.0;
bool   g_botRunning   = true;
int    g_magic        = MagicNumber;
string g_lastHash     = "";

//--- state
datetime g_lastBar       = 0;
int      g_lastSignalDir = 0;
int      g_cooldownLeft  = 0;
string   g_lastDir       = "--";
bool     g_inEntry       = false;

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
   string j = "{\"BaseLot\": 0.11, \"RiskPct\": 1.0, \"BasketCount\": 5, \"BasketTP\": 15.0, \"MaxDrawdown\": 80.0, \"MaxSpread\": 350, \"LotBoost\": 2.0, \"CooldownBars\": 3, \"ADXMax\": 25.0, \"UseADXFilter\": 1, \"SLMult\": 1.0, \"BotRunning\": 1}";
   FileWriteString(fh, j);
   FileClose(fh);
  }

void LoadSettings()
  {
   double bLot  = ReadSetting("BaseLot",      0.11);
   double rPct  = ReadSetting("RiskPct",      1.0);
   int    bCnt  = (int)ReadSetting("BasketCount",  5.0);
   double bTP   = ReadSetting("BasketTP",    15.0);
   double mDD   = ReadSetting("MaxDrawdown", 80.0);
   double mSprd = ReadSetting("MaxSpread",  350.0);
   double lBst  = ReadSetting("LotBoost",    2.0);
   int    cool  = (int)ReadSetting("CooldownBars", 3.0);
   double adxMx = ReadSetting("ADXMax",     25.0);
   bool   useAdx= (ReadSetting("UseADXFilter", 1.0) > 0.5);
   double slM   = ReadSetting("SLMult",      1.0);
   bool   botOn = (ReadSetting("BotRunning", 1.0) > 0.5);

   string hash = DoubleToString(bLot,3)+DoubleToString(rPct,2)+IntegerToString(bCnt)
               + DoubleToString(bTP,2)+DoubleToString(mDD,1)
               + DoubleToString(mSprd,0)+DoubleToString(lBst,1)
               + IntegerToString(cool)+DoubleToString(adxMx,0)+(useAdx?"1":"0")
               + DoubleToString(slM,1)+(botOn?"1":"0");
   if(hash == g_lastHash) return;
   g_lastHash = hash;

   g_baseLot      = MathMax(0.01, bLot);
   g_riskPct      = MathMax(0.0,  rPct);
   g_basketCount  = MathMax(1,    bCnt);
   g_basketTP     = MathMax(0.5,  bTP);
   g_maxDrawdown  = MathMax(5.0,  mDD);
   g_maxSpread    = mSprd;
   g_lotBoost     = MathMax(1.0,  lBst);
   g_cooldownBars = MathMax(0,    cool);
   g_adxMax       = MathMax(10.0, adxMx);
   g_useADXFilter = useAdx;
   g_slMult       = MathMax(0.1,  slM);
   g_botRunning   = botOn;

   EALog("Settings — BaseLot="+DoubleToString(g_baseLot,2)
         +" RiskPct="+DoubleToString(g_riskPct,1)+"%"
         +" BasketCnt="+IntegerToString(g_basketCount)
         +" TP=$"+DoubleToString(g_basketTP,2)
         +" MaxDD=$"+DoubleToString(g_maxDrawdown,1)
         +" ADXFilter="+(g_useADXFilter?"ON":"OFF"));
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
   g_cooldownLeft = g_cooldownBars;
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
//  AUTO LOT
//===================================================================

double CalcAutoLot()
  {
   if(g_riskPct <= 0.0) return NormLot(g_baseLot);

   double balance   = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskMoney = balance * g_riskPct / 100.0;
   double perTrade  = riskMoney / MathMax(1, g_basketCount);

   int hATR = iATR(_Symbol, PERIOD_M1, 14);
   double atr[];
   ArraySetAsSeries(atr, true);
   double atrVal = 5.0 * _Point * 10;
   if(hATR != INVALID_HANDLE && CopyBuffer(hATR, 0, 1, 1, atr) == 1)
      atrVal = atr[0];
   IndicatorRelease(hATR);

   double slDist   = g_slMult * atrVal;
   double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickSize <= 0 || tickVal <= 0) return NormLot(g_baseLot);

   double slValue = (slDist / tickSize) * tickVal;
   if(slValue <= 0) return NormLot(g_baseLot);

   double lot = perTrade / slValue;
   EALog("AutoLot: bal="+DoubleToString(balance,0)+" risk%="+DoubleToString(g_riskPct,1)
         +" perTrade=$"+DoubleToString(perTrade,2)+" SLval=$"+DoubleToString(slValue,2)
         +"/lot → lot="+DoubleToString(lot,3));
   return NormLot(lot);
  }

//===================================================================
//  CANDLE SIGNAL
//===================================================================

int GetCandleSignal()
  {
   if(g_useADXFilter)
     {
      int hADX = iADX(_Symbol, PERIOD_M1, 14);
      if(hADX == INVALID_HANDLE) { EALog("DIAG skip: ADX handle invalid"); return 0; }
      double adx[];
      ArraySetAsSeries(adx, true);
      if(CopyBuffer(hADX, 0, 0, 2, adx) < 2) { IndicatorRelease(hADX); EALog("DIAG skip: ADX buffer not ready"); return 0; }
      IndicatorRelease(hADX);
      if(adx[1] > g_adxMax)
        {
         EALog("DIAG skip: ADX="+DoubleToString(adx[1],1)+" > max="+DoubleToString(g_adxMax,1)+" (ترند قوي)");
         return 0;
        }
     }

   int hATR = iATR(_Symbol, PERIOD_M1, 14);
   if(hATR == INVALID_HANDLE) { EALog("DIAG skip: ATR handle invalid"); return 0; }
   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(hATR, 0, 0, 3, atr) < 3) { IndicatorRelease(hATR); EALog("DIAG skip: ATR buffer not ready"); return 0; }
   IndicatorRelease(hATR);

   double o[], h[], l[], c[];
   ArraySetAsSeries(o,true); ArraySetAsSeries(h,true);
   ArraySetAsSeries(l,true); ArraySetAsSeries(c,true);
   if(CopyOpen (_Symbol,PERIOD_M1,0,3,o)<3) { EALog("DIAG skip: candle data not ready"); return 0; }
   if(CopyHigh (_Symbol,PERIOD_M1,0,3,h)<3) return 0;
   if(CopyLow  (_Symbol,PERIOD_M1,0,3,l)<3) return 0;
   if(CopyClose(_Symbol,PERIOD_M1,0,3,c)<3) return 0;

   double body  = MathAbs(c[1] - o[1]);
   double range = h[1] - l[1] + 1e-10;
   double atr1  = atr[1];

   if(body < 0.35*atr1 || body/range < 0.30)
     {
      EALog("DIAG skip: candle weak body="+DoubleToString(body,2)
            +" (need>="+DoubleToString(0.35*atr1,2)+") ratio="+DoubleToString(body/range,2));
      return 0;
     }

   if(c[1] > o[1]) return -1; // شمعة صعود → SELL (mean reversion)
   if(c[1] < o[1]) return  1; // شمعة نزول → BUY
   return 0;
  }

//===================================================================
//  SAFETY SL — واسع لمنع خسارة كبيرة فقط، الإغلاق الحقيقي بالدولار
//===================================================================

double CalcSafetySL(int signal)
  {
   int hATR = iATR(_Symbol, PERIOD_M1, 14);
   double atr[];
   ArraySetAsSeries(atr, true);
   double atrVal = 5.0 * _Point * 10;
   if(hATR != INVALID_HANDLE && CopyBuffer(hATR, 0, 1, 1, atr) == 1)
      atrVal = atr[0];
   IndicatorRelease(hATR);

   double pip   = SymbolInfoDouble(_Symbol, SYMBOL_POINT) * 10;
   double slPts = (SAFETY_SL_MULT * g_slMult * atrVal) / pip;
   double bid   = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask   = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   if(signal == 1) return NormalizeDouble(bid - slPts * pip, _Digits);
   else            return NormalizeDouble(ask + slPts * pip, _Digits);
  }

//===================================================================
//  DASHBOARD
//===================================================================

void UpdateDashboard(int basket, double net)
  {
   int x = PANEL_X, xV = PANEL_X + 90, y = PANEL_Y;

   DLabel("K_NAME", "⬦ GRX SCALPER",  x, y, clrGold); y += ROW_H;
   DLabel("K_BSK",  "BASKET",    x, y, CLR_KEY);
   DLabel("V_BSK",  IntegerToString(basket), xV, y, basket>0?clrLime:clrGray); y += ROW_H;
   DLabel("K_DIR",  "DIRECTION", x, y, CLR_KEY);
   color dc = (g_lastDir=="BUY")?clrLime:(g_lastDir=="SELL"?clrRed:clrGray);
   DLabel("V_DIR",  g_lastDir,   xV, y, dc); y += ROW_H;
   DLabel("K_NET",  "NET P/L",   x, y, CLR_KEY);
   color nc = net > 0 ? clrLime : (net < 0 ? clrRed : clrGray);
   DLabel("V_NET",  "$"+DoubleToString(net,2), xV, y, nc); y += ROW_H;
   DLabel("K_TP",   "BASKET TP", x, y, CLR_KEY);
   DLabel("V_TP",   "$"+DoubleToString(g_basketTP,2), xV, y, clrCyan); y += ROW_H;
   DLabel("K_CNT",  "BASKET CNT",x, y, CLR_KEY);
   DLabel("V_CNT",  IntegerToString(g_basketCount)+"x", xV, y, clrCyan); y += ROW_H;
   DLabel("K_BOT",  "BOT",       x, y, CLR_KEY);
   DLabel("V_BOT",  g_botRunning?"ON":"OFF", xV, y, g_botRunning?clrLime:clrRed); y += ROW_H;
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   DLabel("K_SPR",  "SPREAD",    x, y, CLR_KEY);
   DLabel("V_SPR",  IntegerToString(spread), xV, y, spread>g_maxSpread?clrRed:clrGray);
   ChartRedraw(0);
  }

//===================================================================
//  ENTRY LOGIC
//===================================================================

void TryEntry()
  {
   if(!g_botRunning) { EALog("DIAG skip: BotRunning=OFF"); return; }
   if(g_inEntry)     { EALog("DIAG skip: entry in progress"); return; }
   if(CountBasket() > 0) { EALog("DIAG skip: basket مفتوح"); return; }

   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > g_maxSpread)
     {
      EALog("DIAG skip: spread="+IntegerToString(spread)+" > max="+DoubleToString(g_maxSpread,0));
      return;
     }

   int signal = GetCandleSignal();
   if(signal == 0) return;

   if(g_cooldownLeft > 0 && signal == g_lastSignalDir)
     {
      EALog("DIAG skip: cooldown="+IntegerToString(g_cooldownLeft)+" bars (نفس اتجاه آخر إشارة)");
      return;
     }

   string dir = (signal == 1) ? "BUY" : "SELL";
   g_lastDir       = dir;
   g_lastSignalDir = signal;

   double lot = CalcAutoLot();
   double sl  = CalcSafetySL(signal); // SL أمان واسع فقط — بدون TP سعري

   g_inEntry = true;
   int opened = 0;
   for(int i = 0; i < g_basketCount; i++)
     {
      bool ok = false;
      if(signal == 1)
         ok = trade.Buy (lot, _Symbol, SymbolInfoDouble(_Symbol,SYMBOL_ASK), sl, 0, "GRX_BUY");
      else
         ok = trade.Sell(lot, _Symbol, SymbolInfoDouble(_Symbol,SYMBOL_BID), sl, 0, "GRX_SELL");
      if(ok) opened++;
      else { EALog("FAIL "+dir+" #"+IntegerToString(i+1)); break; }
      Sleep(50);
     }
   EALog("BASKET OPENED "+IntegerToString(opened)+"/"+IntegerToString(g_basketCount)
         +" "+dir+" lot="+DoubleToString(lot,3)+" SL="+DoubleToString(sl,2));
   g_inEntry = false;
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
   EALog("Init — "+EA_NAME+" v"+EA_VERSION);
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

   if(basket > 0 && net >= g_basketTP)
     {
      CloseBasket("TP $"+DoubleToString(net,2));
      UpdateDashboard(0, 0);
      return;
     }

   if(basket > 0 && net <= -g_maxDrawdown)
     {
      CloseBasket("MAXDD $"+DoubleToString(net,2));
      UpdateDashboard(0, 0);
      return;
     }

   UpdateDashboard(basket, net);

   datetime barTime = iTime(_Symbol, PERIOD_M1, 0);
   if(barTime == g_lastBar) return;
   g_lastBar = barTime;

   if(g_cooldownLeft > 0) g_cooldownLeft--;

   TryEntry();
  }
//+------------------------------------------------------------------+
