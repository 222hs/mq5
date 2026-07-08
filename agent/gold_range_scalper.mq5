//+------------------------------------------------------------------+
//|                                        GoldRangeScalper v2.00   |
//|          Dual Basket — BUY basket + SELL basket independently    |
//+------------------------------------------------------------------+
#property copyright "GRS"
#property version   "2.00"
#property strict

#include <Trade\Trade.mqh>

//--- inputs
input double   BaseLot        = 0.11;   // حجم اللوت الأساسي
input double   RiskPct        = 1.0;    // نسبة المخاطرة % (0=تعطيل)
input int      BasketCount    = 5;      // عدد صفقات كل سلة
input double   BasketTP       = 15.0;   // TP كل سلة بالدولار
input double   MaxDrawdown    = 80.0;   // أقصى خسارة لكل سلة قبل الإغلاق
input double   MaxSpread      = 350.0;  // أقصى سبريد
input double   LotBoost       = 2.0;    // مضاعف اللوت
input int      CooldownBars   = 3;      // بارات الانتظار بعد إغلاق السلة
input double   ADXMax         = 25.0;   // حد ADX (فلتر الترند)
input bool     UseADXFilter   = true;   // تفعيل فلتر ADX
input double   SLMult         = 1.0;    // مضاعف SL الأمان
input double   ReverseStopUSD = 5.0;   // خسارة تشغّل الإغلاق المبكر (0=معطّل)
input int      MagicBuy       = 88801;  // Magic سلة BUY
input int      MagicSell      = 88802;  // Magic سلة SELL
input bool     UsePTDFilter   = true;   // فلتر PTD
input int      PTDFast        = 5;
input int      PTDSlow        = 10;

//--- EA identity
#define EA_NAME        "GoldRangeX"
#define EA_VERSION     "2.00"
#define SETTINGS_FILE  "GRX_Settings.json"
#define LOG_FILE       "GRX_Log.txt"
#define DASH_PREFIX    "GRX_D_"
#define PANEL_X        10
#define PANEL_Y        230
#define ROW_H          16
#define CLR_KEY        clrSilver
#define SAFETY_SL_MULT 4.0

CTrade trade;

//--- settings globals
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
double g_reverseStop  = 5.0;
bool   g_botRunning   = true;
int    g_magicBuy     = MagicBuy;
int    g_magicSell    = MagicSell;
string g_lastHash     = "";

//--- shared state
datetime g_lastBar   = 0;
bool     g_inEntry   = false;
int      g_hPTD      = INVALID_HANDLE;

//--- BUY basket state
double g_buyDynamicTP  = 0;
int    g_buyCooldown   = 0;
int    g_buyWins       = 0;
int    g_buyLosses     = 0;

//--- SELL basket state
double g_sellDynamicTP = 0;
int    g_sellCooldown  = 0;
int    g_sellWins      = 0;
int    g_sellLosses    = 0;

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
   string j = "{\"BaseLot\":0.11,\"RiskPct\":1.0,\"BasketCount\":5,\"BasketTP\":15.0,\"MaxDrawdown\":80.0,\"MaxSpread\":350,\"LotBoost\":2.0,\"CooldownBars\":3,\"ADXMax\":25.0,\"UseADXFilter\":1,\"SLMult\":1.0,\"ReverseStopUSD\":5.0,\"BotRunning\":1}";
   FileWriteString(fh, j);
   FileClose(fh);
  }

void LoadSettings()
  {
   double bLot   = ReadSetting("BaseLot",         BaseLot);
   double rPct   = ReadSetting("RiskPct",          RiskPct);
   int    bCnt   = (int)ReadSetting("BasketCount", (double)BasketCount);
   double bTP    = ReadSetting("BasketTP",         BasketTP);
   double mDD    = ReadSetting("MaxDrawdown",      MaxDrawdown);
   double mSprd  = ReadSetting("MaxSpread",        MaxSpread);
   double lBst   = ReadSetting("LotBoost",         LotBoost);
   int    cool   = (int)ReadSetting("CooldownBars",(double)CooldownBars);
   double adxMx  = ReadSetting("ADXMax",           ADXMax);
   bool   useAdx = (ReadSetting("UseADXFilter",    UseADXFilter?1.0:0.0) > 0.5);
   double slM    = ReadSetting("SLMult",           SLMult);
   double revStp = ReadSetting("ReverseStopUSD",   ReverseStopUSD);
   bool   botOn  = (ReadSetting("BotRunning",      1.0) > 0.5);

   string hash = DoubleToString(bLot,3)+DoubleToString(rPct,2)+IntegerToString(bCnt)
               + DoubleToString(bTP,2)+DoubleToString(mDD,1)+DoubleToString(mSprd,0)
               + DoubleToString(lBst,1)+IntegerToString(cool)+DoubleToString(adxMx,0)
               + (useAdx?"1":"0")+DoubleToString(slM,1)+DoubleToString(revStp,2)+(botOn?"1":"0");
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
   g_reverseStop  = MathMax(0.0,  revStp);
   g_botRunning   = botOn;

   EALog("Settings — BaseLot="+DoubleToString(g_baseLot,2)
         +" BasketCnt="+IntegerToString(g_basketCount)
         +" TP=$"+DoubleToString(g_basketTP,2)
         +" MaxDD=$"+DoubleToString(g_maxDrawdown,1)
         +" RevStop=$"+DoubleToString(g_reverseStop,1));
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
//  DUAL BASKET HELPERS
//===================================================================

int CountBasketByMagic(int magic)
  {
   int n = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != magic) continue;
      n++;
     }
   return n;
  }

double BasketProfitByMagic(int magic)
  {
   double total = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != magic) continue;
      total += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
     }
   return total;
  }

void CloseBasketByMagic(int magic, string reason, int &wins, int &losses, double &dynTP)
  {
   double net = BasketProfitByMagic(magic);
   string side = (magic == g_magicBuy) ? "BUY" : "SELL";
   if(net >= 0)
     { losses = 0; wins++; EALog("CLOSE "+side+" ["+reason+"] $"+DoubleToString(net,2)+" ✅"); }
   else
     { wins = 0; losses++; EALog("CLOSE "+side+" ["+reason+"] $"+DoubleToString(net,2)+" ❌"); }
   dynTP = CalcDynamicTP(wins);
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != magic) continue;
      trade.PositionClose(t, (ulong)(g_maxSpread*2));
      Sleep(80);
     }
  }

//===================================================================
//  DYNAMIC TP
//===================================================================

double CalcDynamicTP(int wins)
  {
   int hATR = iATR(_Symbol, PERIOD_M1, 14);
   double atrBase = g_basketTP;
   if(hATR != INVALID_HANDLE)
     {
      double atr[];
      ArraySetAsSeries(atr, true);
      if(CopyBuffer(hATR, 0, 1, 1, atr) >= 1)
        {
         double atrDollar = atr[0] * SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE)
                          / SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE)
                          * g_baseLot * g_basketCount;
         atrBase = MathMax(g_basketTP * 0.5, MathMin(g_basketTP * 2.0, atrDollar * 1.5));
        }
      IndicatorRelease(hATR);
     }
   double tp = MathMax(g_basketTP * 0.5,
               MathMin(g_basketTP * 3.0, atrBase + wins * 2.0));
   return tp;
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
   return NormLot(perTrade / slValue);
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
//  CANDLE SIGNAL  (+1=BUY -1=SELL 0=لا إشارة)
//===================================================================

int GetCandleSignal(int losses)
  {
   if(g_useADXFilter)
     {
      int hADX = iADX(_Symbol, PERIOD_M1, 14);
      if(hADX == INVALID_HANDLE) return 0;
      double adx[];
      ArraySetAsSeries(adx, true);
      if(CopyBuffer(hADX, 0, 0, 2, adx) < 2) { IndicatorRelease(hADX); return 0; }
      IndicatorRelease(hADX);
      if(adx[1] > g_adxMax)
        { EALog("ADX skip: "+DoubleToString(adx[1],1)+" > "+DoubleToString(g_adxMax,1)); return 0; }
     }

   int hATR = iATR(_Symbol, PERIOD_M1, 14);
   if(hATR == INVALID_HANDLE) return 0;
   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(hATR, 0, 0, 3, atr) < 3) { IndicatorRelease(hATR); return 0; }
   IndicatorRelease(hATR);

   double o[], h[], l[], c[];
   ArraySetAsSeries(o,true); ArraySetAsSeries(h,true);
   ArraySetAsSeries(l,true); ArraySetAsSeries(c,true);
   if(CopyOpen (_Symbol,PERIOD_M1,0,3,o)<3) return 0;
   if(CopyHigh (_Symbol,PERIOD_M1,0,3,h)<3) return 0;
   if(CopyLow  (_Symbol,PERIOD_M1,0,3,l)<3) return 0;
   if(CopyClose(_Symbol,PERIOD_M1,0,3,c)<3) return 0;

   double body  = MathAbs(c[1] - o[1]);
   double range = h[1] - l[1] + 1e-10;
   double atr1  = atr[1];

   double minRatio = 0.30;
   if(losses == 1)      minRatio = 0.45;
   else if(losses == 2) minRatio = 0.55;
   else if(losses >= 3) minRatio = 0.65;

   if(body < 0.35*atr1 || body/range < minRatio) return 0;

   int rawSignal = 0;
   if(c[1] > o[1]) rawSignal =  1; // شمعة صعود → BUY
   if(c[1] < o[1]) rawSignal = -1; // شمعة نزول → SELL
   if(rawSignal == 0) return 0;

   if(UsePTDFilter && g_hPTD != INVALID_HANDLE)
     {
      double ptdTrend[];
      ArraySetAsSeries(ptdTrend, true);
      if(CopyBuffer(g_hPTD, 6, 0, 2, ptdTrend) >= 2)
        {
         int trend = (int)ptdTrend[1];
         if(trend == 0 && rawSignal == -1) { EALog("PTD block SELL"); return 0; }
         if(trend == 1 && rawSignal ==  1) { EALog("PTD block BUY");  return 0; }
        }
     }
   return rawSignal;
  }

//===================================================================
//  SAFETY SL
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
//  OPEN BASKET
//===================================================================

void OpenBasket(int signal, int magic)
  {
   if(g_inEntry) return;
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > g_maxSpread) { EALog("skip spread="+IntegerToString(spread)); return; }

   string dir = (signal == 1) ? "BUY" : "SELL";
   string tag = (signal == 1) ? "GRX_BUY" : "GRX_SELL";
   double lot = CalcAutoLot();
   double sl  = CalcSafetySL(signal);

   trade.SetExpertMagicNumber(magic);
   g_inEntry = true;
   int opened = 0;
   for(int i = 0; i < g_basketCount; i++)
     {
      bool ok = false;
      if(signal == 1)
         ok = trade.Buy (lot, _Symbol, SymbolInfoDouble(_Symbol,SYMBOL_ASK), sl, 0, tag);
      else
         ok = trade.Sell(lot, _Symbol, SymbolInfoDouble(_Symbol,SYMBOL_BID), sl, 0, tag);
      if(ok) opened++;
      else { EALog("FAIL "+dir+" #"+IntegerToString(i+1)); break; }
      Sleep(50);
     }
   EALog("BASKET "+dir+" OPENED "+IntegerToString(opened)+"/"+IntegerToString(g_basketCount)
         +" magic="+IntegerToString(magic)+" lot="+DoubleToString(lot,3));
   g_inEntry = false;
  }

//===================================================================
//  DASHBOARD
//===================================================================

void UpdateDashboard(int buyN, double buyNet, int sellN, double sellNet)
  {
   int x = PANEL_X, xV = PANEL_X + 100, y = PANEL_Y;
   DLabel("K_NAME",  "⬦ GRX DUAL BASKET", x, y, clrGold); y += ROW_H;

   DLabel("K_BUY",   "BUY BASKET",  x, y, CLR_KEY);
   color bc = buyN>0 ? clrLime : clrGray;
   DLabel("V_BUY",   IntegerToString(buyN)+" pos  $"+DoubleToString(buyNet,2), xV, y, bc); y += ROW_H;

   DLabel("K_SELL",  "SELL BASKET", x, y, CLR_KEY);
   color sc = sellN>0 ? clrRed : clrGray;
   DLabel("V_SELL",  IntegerToString(sellN)+" pos  $"+DoubleToString(sellNet,2), xV, y, sc); y += ROW_H;

   double totalNet = buyNet + sellNet;
   DLabel("K_NET",   "TOTAL NET",   x, y, CLR_KEY);
   color nc = totalNet>0?clrLime:(totalNet<0?clrRed:clrGray);
   DLabel("V_NET",   "$"+DoubleToString(totalNet,2), xV, y, nc); y += ROW_H;

   DLabel("K_TP",    "BASKET TP",   x, y, CLR_KEY);
   DLabel("V_TP",    "$"+DoubleToString(g_basketTP,2), xV, y, clrCyan); y += ROW_H;

   DLabel("K_BOT",   "BOT",         x, y, CLR_KEY);
   DLabel("V_BOT",   g_botRunning?"ON":"OFF", xV, y, g_botRunning?clrLime:clrRed);
   ChartRedraw(0);
  }

//===================================================================
//  EA EVENTS
//===================================================================

int OnInit()
  {
   trade.SetDeviationInPoints(30);
   trade.SetTypeFilling(ORDER_FILLING_IOC);
   WriteDefaultSettings();
   LoadSettings();
   EventSetTimer(5);
   if(UsePTDFilter)
     {
      g_hPTD = iCustom(_Symbol, PERIOD_M1, "pivot_trend_detector", PTDFast, PTDSlow);
      if(g_hPTD == INVALID_HANDLE)
         EALog("⚠️ PTD handle فشل");
      else
         EALog("✅ PTD filter مفعّل");
     }
   g_buyDynamicTP  = CalcDynamicTP(0);
   g_sellDynamicTP = CalcDynamicTP(0);
   EALog("Init — "+EA_NAME+" v"+EA_VERSION+" (Dual Basket)");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(g_hPTD != INVALID_HANDLE) IndicatorRelease(g_hPTD);
   ObjectsDeleteAll(0, DASH_PREFIX);
   EALog("Deinit reason="+IntegerToString(reason));
  }

void OnTimer()
  {
   LoadSettings();
   UpdateDashboard(
      CountBasketByMagic(g_magicBuy),  BasketProfitByMagic(g_magicBuy),
      CountBasketByMagic(g_magicSell), BasketProfitByMagic(g_magicSell));
  }

void OnTick()
  {
   LoadSettings();
   if(!g_botRunning) return;

   int    buyN   = CountBasketByMagic(g_magicBuy);
   double buyNet = BasketProfitByMagic(g_magicBuy);
   int    sellN  = CountBasketByMagic(g_magicSell);
   double sellNet= BasketProfitByMagic(g_magicSell);

   if(g_buyDynamicTP  <= 0) g_buyDynamicTP  = CalcDynamicTP(g_buyWins);
   if(g_sellDynamicTP <= 0) g_sellDynamicTP = CalcDynamicTP(g_sellWins);

   // ── إدارة سلة BUY ─────────────────────────────────────────────
   if(buyN > 0)
     {
      if(buyNet >= g_buyDynamicTP)
        { CloseBasketByMagic(g_magicBuy, "TP", g_buyWins, g_buyLosses, g_buyDynamicTP);
          g_buyCooldown = g_cooldownBars; buyN = 0; }
      else if(g_reverseStop > 0 && buyNet <= -g_reverseStop)
        { CloseBasketByMagic(g_magicBuy, "REV_STOP", g_buyWins, g_buyLosses, g_buyDynamicTP);
          g_buyCooldown = 0; buyN = 0; }
      else if(buyNet <= -g_maxDrawdown)
        { CloseBasketByMagic(g_magicBuy, "MAXDD", g_buyWins, g_buyLosses, g_buyDynamicTP);
          g_buyCooldown = g_cooldownBars; buyN = 0; }
     }

   // ── إدارة سلة SELL ────────────────────────────────────────────
   if(sellN > 0)
     {
      if(sellNet >= g_sellDynamicTP)
        { CloseBasketByMagic(g_magicSell, "TP", g_sellWins, g_sellLosses, g_sellDynamicTP);
          g_sellCooldown = g_cooldownBars; sellN = 0; }
      else if(g_reverseStop > 0 && sellNet <= -g_reverseStop)
        { CloseBasketByMagic(g_magicSell, "REV_STOP", g_sellWins, g_sellLosses, g_sellDynamicTP);
          g_sellCooldown = 0; sellN = 0; }
      else if(sellNet <= -g_maxDrawdown)
        { CloseBasketByMagic(g_magicSell, "MAXDD", g_sellWins, g_sellLosses, g_sellDynamicTP);
          g_sellCooldown = g_cooldownBars; sellN = 0; }
     }

   UpdateDashboard(buyN, buyNet, sellN, sellNet);

   // ── بار جديد فقط ──────────────────────────────────────────────
   datetime barTime = iTime(_Symbol, PERIOD_M1, 0);
   if(barTime == g_lastBar) return;
   g_lastBar = barTime;

   if(g_buyCooldown  > 0) g_buyCooldown--;
   if(g_sellCooldown > 0) g_sellCooldown--;

   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > g_maxSpread) return;

   int signal = GetCandleSignal(MathMax(g_buyLosses, g_sellLosses));
   if(signal == 0) return;

   // ── فتح سلة BUY لو إشارة صعود ─────────────────────────────────
   if(signal == 1 && buyN == 0 && g_buyCooldown == 0)
      OpenBasket(1, g_magicBuy);

   // ── فتح سلة SELL لو إشارة نزول ────────────────────────────────
   if(signal == -1 && sellN == 0 && g_sellCooldown == 0)
      OpenBasket(-1, g_magicSell);
  }
//+------------------------------------------------------------------+
