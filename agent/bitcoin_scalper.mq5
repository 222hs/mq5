//+------------------------------------------------------------------+
//|                                             BitcoinScalperEA.mq5 |
//|                                        BitcoinScalperX v1.00     |
//|  BTC M1 scalper — same logic as GoldScalperX, BTC-tuned params  |
//+------------------------------------------------------------------+
#property copyright "BitcoinScalperX"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- inputs
input double          LotSize      = 0.01;     // Lot size (BTC — ابدأ صغير)
input ENUM_TIMEFRAMES TF           = PERIOD_M1;// Working timeframe
input int             MaxPositions = 5;        // Max open positions
input int             CooldownSecs = 90;       // Cooldown between entries (sec)
input int             MaxSpread    = 2000;     // Max spread in points (BTC spread أعلى)
input bool            UseSession   = false;    // Session filter (BTC = 24/7)

//--- constants
#define EA_NAME       "BitcoinScalperX"
#define EA_VERSION    "1.00"
#define DASH_PREFIX   "BSX_D_"
#define SETTINGS_FILE "BSX_Settings.json"
#define CURRENT_FILE  "BSX_Current.json"

//--- panel layout
#define PANEL_X   300   // على يمين بوت الذهب
#define PANEL_Y   10
#define PANEL_W   275
#define PAD       18
#define ROW_H     22
#define TITLE_H   28

//--- panel colors
#define CLR_BG      C'15,15,25'
#define CLR_BORDER  clrDimGray
#define CLR_DIVIDER C'55,55,75'
#define CLR_KEY     C'130,130,155'
#define CLR_GOOD    clrLime
#define CLR_BAD     clrOrangeRed
#define CLR_HILITE  clrDeepSkyBlue
#define CLR_NEUTRAL clrSilver

//--- globals
CTrade         trade;
CPositionInfo  posInfo;

long     g_magic         = 0;
int      hRSI = INVALID_HANDLE, hEMA9 = INVALID_HANDLE,
         hEMA21 = INVALID_HANDLE, hATR = INVALID_HANDLE,
         hH1EMA = INVALID_HANDLE;
datetime g_lastEntryTime = 0;
datetime g_lastBar       = 0;
double   g_snapRSI       = 50.0;
bool     g_snapEMAUp     = false;
double   g_snapATR       = 0.0;
int      g_totalTrades   = 0;

// إعدادات — قيم افتراضية مناسبة للبتكوين
double   g_lot             = 0.01;
int      g_maxPositions    = 5;
int      g_cooldownSecs    = 90;
double   g_maxSpread       = 2000.0;
double   g_tpUSD           = 20.0;   // BTC يتحرك بشكل كبير — TP/SL أعلى
double   g_slUSD           = 10.0;
double   g_maxLossPerDay   = 100.0;
double   g_maxProfitPerDay = 500.0;
int      g_tradeHoursStart = 0;
int      g_tradeHoursEnd   = 24;
int      g_orderType       = 0;   // 0=MARKET  1=LIMIT  2=STOP  3=BASKET
bool     g_newsBlock       = false;
string   g_newsTitle       = "";
int      g_riskMode        = 0;    // 0=لوت ثابت  1=نسبة من الرصيد
double   g_riskPct         = 1.0;
double   g_rsiBuyMax       = 65.0; // Claude auto-adjust
double   g_rsiSellMin      = 35.0;
bool     g_useH1Filter     = true;  // فلتر اتجاه H1 EMA21
bool     g_botRunning      = true;

// Strategy mode — bitmask: 1=Grid  2=Hedge  4=Scale
int    g_strategyMode  = 0;
int    g_gridLevels    = 3;
int    g_gridStep      = 50;
double g_hedgeLotMult  = 0.5;
int    g_scaleStep     = 30;
double g_scaleMult     = 1.5;
int    g_maxScales     = 3;

ulong  g_scaledFrom[200];
int    g_scaledCount = 0;

// Day P&L tracking
double   g_dayPL   = 0.0;
datetime g_today   = 0;

string   g_lastSettingsHash = "";

//+------------------------------------------------------------------+
long MagicFromSymbol(const string sym)
  {
   ulong h = 9973; // seed مختلف عن الذهب
   int len = StringLen(sym);
   for(int i = 0; i < len; i++)
      h = ((h << 5) + h) + (ulong)StringGetCharacter(sym, i);
   return (long)(200000 + (h % 800000)); // نطاق مختلف عن بوت الذهب
  }

//+------------------------------------------------------------------+
double ReadSetting(const string name, const double fallback)
  {
   string fname = "BSX_" + name + ".txt";
   int fh = FileOpen(fname, FILE_READ|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return fallback;
   string s = FileReadString(fh);
   FileClose(fh);
   double v = StringToDouble(s);
   return (s == "" || (v == 0.0 && s != "0" && s != "0.0")) ? fallback : v;
  }

//+------------------------------------------------------------------+
void WriteCurrentSettings()
  {
   int fh = FileOpen(CURRENT_FILE, FILE_WRITE|FILE_TXT|FILE_COMMON);
   if(fh == INVALID_HANDLE) return;
   string j = "{\n";
   j += "  \"LotSize\": "        + DoubleToString(g_lot,2)            + ",\n";
   j += "  \"TP_USD\": "         + DoubleToString(g_tpUSD,2)          + ",\n";
   j += "  \"SL_USD\": "         + DoubleToString(g_slUSD,2)          + ",\n";
   j += "  \"MaxSpread\": "      + DoubleToString(g_maxSpread,0)      + ",\n";
   j += "  \"MaxPositions\": "   + IntegerToString(g_maxPositions)    + ",\n";
   j += "  \"CooldownSecs\": "   + IntegerToString(g_cooldownSecs)    + ",\n";
   j += "  \"MaxLossPerDay\": "  + DoubleToString(g_maxLossPerDay,2)  + ",\n";
   j += "  \"MaxProfitPerDay\": "+ DoubleToString(g_maxProfitPerDay,2)+ ",\n";
   j += "  \"TradeHoursStart\": "+ IntegerToString(g_tradeHoursStart) + ",\n";
   j += "  \"TradeHoursEnd\": "  + IntegerToString(g_tradeHoursEnd)   + ",\n";
   j += "  \"BotRunning\": "     + (g_botRunning ? "1" : "0")         + ",\n";
   j += "  \"UseH1Filter\": "   + (g_useH1Filter ? "1" : "0")        + ",\n";
   j += "  \"StrategyMode\": " + IntegerToString(g_strategyMode)     + ",\n";
   j += "  \"GridLevels\": "   + IntegerToString(g_gridLevels)       + ",\n";
   j += "  \"GridStep\": "     + IntegerToString(g_gridStep)         + ",\n";
   j += "  \"HedgeLotMult\": " + DoubleToString(g_hedgeLotMult,2)   + ",\n";
   j += "  \"ScaleStep\": "    + IntegerToString(g_scaleStep)        + ",\n";
   j += "  \"ScaleMult\": "    + DoubleToString(g_scaleMult,2)       + ",\n";
   j += "  \"MaxScales\": "    + IntegerToString(g_maxScales)        + ",\n";
   j += "  \"OrderType\": "    + IntegerToString(g_orderType)        + "\n";
   j += "}";
   FileWriteString(fh, j);
   FileClose(fh);
  }

//+------------------------------------------------------------------+
void LoadNewsBlock()
  {
   // يشارك نفس ملف الأخبار مع بوت الذهب
   int fh = FileOpen("GSX_NewsBlock.txt", FILE_READ|FILE_TXT|FILE_COMMON);
   if(fh == INVALID_HANDLE) { g_newsBlock=false; g_newsTitle=""; return; }
   string line = FileReadString(fh);
   FileClose(fh);
   if(StringLen(line) > 0 && line[0] == '1')
     { g_newsBlock=true;
       int sep = StringFind(line,"|");
       g_newsTitle = sep>0 ? StringSubstr(line,sep+1) : "High Impact News"; }
   else
     { g_newsBlock=false; g_newsTitle=""; }
  }

//+------------------------------------------------------------------+
double CalcLot()
  {
   if(g_riskMode == 0) return NormalizeLot(g_lot);
   if(g_slUSD <= 0)    return NormalizeLot(g_lot);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskAmt = balance * (g_riskPct / 100.0);
   double lot     = riskAmt / g_slUSD;
   double step    = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minL    = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxL    = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   lot = MathFloor(lot / step) * step;
   lot = MathMax(minL, MathMin(maxL, lot));
   return NormalizeLot(lot);
  }

//+------------------------------------------------------------------+
void LoadSettings()
  {
   double lot    = ReadSetting("LotSize",        LotSize);
   double spread = ReadSetting("MaxSpread",       (double)MaxSpread);
   int    maxPos = (int)ReadSetting("MaxPositions",(double)MaxPositions);
   int    cd     = (int)ReadSetting("CooldownSecs",(double)CooldownSecs);
   double tp     = ReadSetting("TP_USD",          20.0);
   double sl     = ReadSetting("SL_USD",          10.0);
   double maxL   = ReadSetting("MaxLossPerDay",   100.0);
   double maxP   = ReadSetting("MaxProfitPerDay", 500.0);
   int    hStart = (int)ReadSetting("TradeHoursStart", 0.0);
   int    hEnd   = (int)ReadSetting("TradeHoursEnd",  24.0);
   bool   botOn  = (ReadSetting("BotRunning", 1.0) > 0.5);
   int    ordTyp = (int)ReadSetting("OrderType", 0.0);
   int    rMode  = (int)ReadSetting("RiskMode",  0.0);
   double rPct   = ReadSetting("RiskPercent",    1.0);
   double rsiBM  = ReadSetting("RSIBuyMax",      65.0);
   double rsiSM  = ReadSetting("RSISellMin",     35.0);
   bool   useH1  = (ReadSetting("UseH1Filter",   1.0) > 0.5);
   int    sMode  = (int)ReadSetting("StrategyMode", 0.0);
   int    gLev   = (int)ReadSetting("GridLevels",   3.0);
   int    gStep  = (int)ReadSetting("GridStep",    50.0);
   double hMult  = ReadSetting("HedgeLotMult",      0.5);
   int    scStep = (int)ReadSetting("ScaleStep",   30.0);
   double scMult = ReadSetting("ScaleMult",          1.5);
   int    scMax  = (int)ReadSetting("MaxScales",    3.0);

   string hash = DoubleToString(lot,2)+DoubleToString(tp,2)+DoubleToString(sl,2)
               + IntegerToString(maxPos)+DoubleToString(spread,0)
               + IntegerToString(cd)
               + DoubleToString(maxL,2)+DoubleToString(maxP,2)
               + IntegerToString(hStart)+IntegerToString(hEnd)
               + IntegerToString(ordTyp)+(botOn?"1":"0")
               + IntegerToString(rMode)+DoubleToString(rPct,1)
               + DoubleToString(rsiBM,1)+DoubleToString(rsiSM,1)
               + (useH1?"1":"0")
               + IntegerToString(sMode)+IntegerToString(gLev)+IntegerToString(gStep)
               + DoubleToString(hMult,2)+IntegerToString(scStep)
               + DoubleToString(scMult,2)+IntegerToString(scMax);
   bool changed = (hash != g_lastSettingsHash);
   g_lastSettingsHash = hash;

   g_lot=lot; g_maxSpread=spread; g_maxPositions=maxPos; g_cooldownSecs=cd;
   g_tpUSD=tp; g_slUSD=sl; g_maxLossPerDay=maxL; g_maxProfitPerDay=maxP;
   g_tradeHoursStart=hStart; g_tradeHoursEnd=hEnd; g_botRunning=botOn;
   g_orderType=ordTyp; g_riskMode=rMode; g_riskPct=rPct;
   g_rsiBuyMax=rsiBM; g_rsiSellMin=rsiSM;
   g_useH1Filter=useH1;
   g_strategyMode=sMode;
   g_gridLevels=MathMax(1,gLev);  g_gridStep=MathMax(10,gStep);
   g_hedgeLotMult=MathMax(0.1,MathMin(2.0,hMult));
   g_scaleStep=MathMax(10,scStep); g_scaleMult=MathMax(1.0,scMult); g_maxScales=MathMax(1,scMax);
   LoadNewsBlock();

   if(changed)
     {
      string otStr = g_orderType==3?"BASKET":g_orderType==1?"LIMIT":g_orderType==2?"STOP":"MARKET";
      string lotStr = g_riskMode==1
                    ? ("DYNAMIC "+DoubleToString(g_riskPct,1)+"%="+DoubleToString(CalcLot(),2))
                    : DoubleToString(g_lot,2);
      Print(EA_NAME," ✅ إعدادات:"
            " Lot=",lotStr," TP$=",g_tpUSD," SL$=",g_slUSD,
            " MaxPos=",g_maxPositions," Spread=",g_maxSpread,
            " Hours=",g_tradeHoursStart,"-",g_tradeHoursEnd,
            " Bot=",g_botRunning?"ON":"OFF",
            " Order=",otStr,
            " RSI=",g_rsiBuyMax,"/",g_rsiSellMin);
     }
   // heartbeat دائم — الـ Agent يعتمد على mtime هذا الملف لكشف أن البوت حي
   WriteCurrentSettings();
  }

//+------------------------------------------------------------------+
bool InTradingHours()
  {
   if(g_tradeHoursStart == 0 && g_tradeHoursEnd >= 24) return true;
   MqlDateTime dt; TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   if(g_tradeHoursStart < g_tradeHoursEnd)
      return (h >= g_tradeHoursStart && h < g_tradeHoursEnd);
   return (h >= g_tradeHoursStart || h < g_tradeHoursEnd);
  }

//+------------------------------------------------------------------+
bool DayLimitHit()
  {
   MqlDateTime dt; TimeToStruct(TimeCurrent(), dt);
   datetime today = (datetime)(TimeCurrent() - dt.hour*3600 - dt.min*60 - dt.sec);
   if(today != g_today) { g_today=today; g_dayPL=0.0; }
   if(g_maxLossPerDay > 0.0   && g_dayPL <= -g_maxLossPerDay)   return true;
   if(g_maxProfitPerDay > 0.0 && g_dayPL >=  g_maxProfitPerDay) return true;
   return false;
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_magic = MagicFromSymbol(_Symbol);
   trade.SetExpertMagicNumber(g_magic);
   trade.SetDeviationInPoints(100); // BTC يحتاج deviation أعلى
   trade.SetTypeFillingBySymbol(_Symbol);

   hRSI   = iRSI(_Symbol, TF,        14, PRICE_CLOSE);
   hEMA9  = iMA (_Symbol, TF,        9,  0, MODE_EMA, PRICE_CLOSE);
   hEMA21 = iMA (_Symbol, TF,        21, 0, MODE_EMA, PRICE_CLOSE);
   hATR   = iATR(_Symbol, TF,        14);
   hH1EMA = iMA (_Symbol, PERIOD_H1, 21, 0, MODE_EMA, PRICE_CLOSE);

   if(hRSI==INVALID_HANDLE||hEMA9==INVALID_HANDLE||
      hEMA21==INVALID_HANDLE||hATR==INVALID_HANDLE||hH1EMA==INVALID_HANDLE)
     { Print(EA_NAME,": indicator init failed"); return(INIT_FAILED); }

   LoadSettings();
   CreateDashboard();
   EventSetTimer(2);
   Print(EA_NAME," v",EA_VERSION," | Magic=",g_magic," | TF=",EnumToString(TF));
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnTimer()  { LoadSettings(); }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(hRSI  !=INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hEMA9 !=INVALID_HANDLE) IndicatorRelease(hEMA9);
   if(hEMA21!=INVALID_HANDLE) IndicatorRelease(hEMA21);
   if(hATR  !=INVALID_HANDLE) IndicatorRelease(hATR);
   ObjectsDeleteAll(0, DASH_PREFIX);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
int CountMyPositions()
  {
   int cnt = 0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==g_magic)
            cnt++;
   return cnt;
  }

//+------------------------------------------------------------------+
double MyFloatingPL()
  {
   double pl = 0.0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==g_magic)
            pl += posInfo.Profit() + posInfo.Swap();
   return pl;
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   ManagePositions();

   datetime barTime = iTime(_Symbol, TF, 0);
   if(barTime == g_lastBar)
     {
      long sp = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      UpdateDashboard(0, 50, InTradingHours(), 0, false, 0, CountMyPositions(), 0, sp);
      return;
     }
   g_lastBar = barTime;
   LoadSettings();

   double rsi[], ema9[], ema21[], atr[];
   double o[], h[], l[], c[];
   ArraySetAsSeries(rsi,true);  ArraySetAsSeries(ema9,true);
   ArraySetAsSeries(ema21,true); ArraySetAsSeries(atr,true);
   ArraySetAsSeries(o,true); ArraySetAsSeries(h,true);
   ArraySetAsSeries(l,true); ArraySetAsSeries(c,true);

   if(CopyBuffer(hRSI,  0,0,4,rsi)  <4) return;
   if(CopyBuffer(hEMA9, 0,0,4,ema9) <4) return;
   if(CopyBuffer(hEMA21,0,0,4,ema21)<4) return;
   if(CopyBuffer(hATR,  0,0,3,atr)  <3) return;
   if(CopyOpen (_Symbol,TF,0,4,o)<4)    return;
   if(CopyHigh (_Symbol,TF,0,4,h)<4)    return;
   if(CopyLow  (_Symbol,TF,0,4,l)<4)    return;
   if(CopyClose(_Symbol,TF,0,4,c)<4)    return;

   double rsi1  = rsi[1];
   double ema91 = ema9[1], ema211 = ema21[1];
   double atr1  = atr[1];

   // H1 BIAS
   double h1ema[];
   ArraySetAsSeries(h1ema, true);
   bool h1BullBias = true;
   if(CopyBuffer(hH1EMA, 0, 0, 3, h1ema) >= 3)
      h1BullBias = (h1ema[1] >= h1ema[2]);

   // CANDLE MOMENTUM — نفس منطق الذهب
   bool bullBar = (c[1] > o[1]) && ((c[1]-o[1])/(h[1]-l[1]+1e-10) >= 0.25)
               && (h[1]-l[1]) <= 5.0*atr1;
   bool bearBar = (c[1] < o[1]) && ((o[1]-c[1])/(h[1]-l[1]+1e-10) >= 0.25)
               && (h[1]-l[1]) <= 5.0*atr1;

   // RSI FILTER — Claude يعدّلها تلقائياً
   bool rsiBuyOK  = (rsi1 <= g_rsiBuyMax);
   bool rsiSellOK = (rsi1 >= g_rsiSellMin);

   int signal = 0;
   bool h1BuyOK  = !g_useH1Filter ||  h1BullBias;
   bool h1SellOK = !g_useH1Filter || !h1BullBias;
   if(bullBar && rsiBuyOK  && h1BuyOK)  signal =  1;
   else if(bearBar && rsiSellOK && h1SellOK) signal = -1;

   long spread   = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   bool spreadOK = (spread <= (long)g_maxSpread);
   bool coolOK   = (TimeCurrent()-g_lastEntryTime >= g_cooldownSecs);
   bool slotsOK  = (CountMyPositions() < g_maxPositions);
   bool sessOK   = InTradingHours();
   bool dayOK    = !DayLimitHit();
   bool newsOK   = !g_newsBlock;
   bool allOK    = spreadOK && coolOK && slotsOK && sessOK && dayOK && newsOK && atr1 > 0.0;

   if(signal != 0 && allOK && g_botRunning && SymbolTradable())
     {
      g_snapRSI   = rsi1;
      g_snapEMAUp = (ema91 > ema211);
      g_snapATR   = atr1;
      int slots = g_maxPositions - CountMyPositions();
      if(slots > 0)
        {
         bool useGrid  = (g_strategyMode & 1) != 0;
         bool useHedge = (g_strategyMode & 2) != 0;
         if(useGrid)
            OpenGrid(signal, atr1);
         else if(useHedge)
            OpenHedge(signal, atr1);
         else
           {
            ENUM_ORDER_TYPE dir = (signal==1) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
            if(g_orderType == 3)
               OpenBasket(dir, atr1, c[1], h[1], l[1], slots);
            else
               OpenTrade(dir, atr1, c[1], h[1], l[1]);
           }
        }
     }

   if((g_strategyMode & 4) != 0 && g_botRunning && !DayLimitHit())
      CheckScale();

   if(bullBar && signal==0)
      Print(EA_NAME,": BUY skipped H1=",h1BullBias?"↑":"↓"," RSI=",DoubleToString(rsi1,0));
   if(bearBar && signal==0)
      Print(EA_NAME,": SELL skipped H1=",h1BullBias?"↑":"↓"," RSI=",DoubleToString(rsi1,0));

   int cdLeft = (int)MathMax(0, g_cooldownSecs-(TimeCurrent()-g_lastEntryTime));
   bool blocked = !(spreadOK && slotsOK && sessOK && dayOK);
   UpdateDashboard(ema91>ema211?1:-1, rsi1, sessOK, signal, blocked, cdLeft,
                   CountMyPositions(), atr1, spread);
  }

//+------------------------------------------------------------------+
bool SymbolTradable()
  {
   long mode = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_MODE);
   return (mode==SYMBOL_TRADE_MODE_FULL||mode==SYMBOL_TRADE_MODE_LONGONLY
           ||mode==SYMBOL_TRADE_MODE_SHORTONLY);
  }

//+------------------------------------------------------------------+
double NormalizeLot(double lot)
  {
   double mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double mx=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(st>0.0) lot=MathFloor(lot/st)*st;
   return MathMax(mn,MathMin(mx,lot));
  }

//+------------------------------------------------------------------+
bool ScaledAlready(ulong ticket)
  {
   for(int i=0;i<g_scaledCount;i++) if(g_scaledFrom[i]==ticket) return true;
   return false;
  }

void OpenGrid(int signal, double atrVal)
  {
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double tickSz=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   double tickVal=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   int    digs=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   long   sl0=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long   frz=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double minD=MathMax((double)(sl0+frz+5),10.0)*tickSz;
   double lot=CalcLot();
   double ptV=(tickSz>0&&lot>0)?(tickVal/tickSz)*lot:1.0;
   double safeMin=MathMax(minD,atrVal*1.5);
   double slD=MathMax(g_slUSD/ptV,safeMin);
   double tpD=MathMax(g_tpUSD/ptV,safeMin);
   double stepD=g_gridStep*tickSz;
   datetime expiry=TimeCurrent()+PeriodSeconds(PERIOD_M1)*g_gridLevels*4;
   bool isBuy=(signal==1);
   int fired=0;
   for(int i=0;i<g_gridLevels;i++)
     {
      if(CountMyPositions()>=g_maxPositions) break;
      bool ok=false;
      if(i==0)
        {
         if(isBuy){double sl=NormalizeDouble(ask-slD,digs);double tp=NormalizeDouble(ask+tpD,digs);ok=trade.Buy(lot,_Symbol,ask,sl,tp,"GRID[0]");}
         else     {double sl=NormalizeDouble(bid+slD,digs);double tp=NormalizeDouble(bid-tpD,digs);ok=trade.Sell(lot,_Symbol,bid,sl,tp,"GRID[0]");}
        }
      else
        {
         double off=i*stepD;
         if(isBuy){double e=NormalizeDouble(bid-off,digs);double sl=NormalizeDouble(e-slD,digs);double tp=NormalizeDouble(e+tpD,digs);ok=trade.BuyLimit(lot,e,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,"GRID["+IntegerToString(i)+"]");}
         else     {double e=NormalizeDouble(ask+off,digs);double sl=NormalizeDouble(e+slD,digs);double tp=NormalizeDouble(e-tpD,digs);ok=trade.SellLimit(lot,e,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,"GRID["+IntegerToString(i)+"]");}
        }
      if(ok){fired++;g_totalTrades++;}
     }
   if(fired>0){g_lastEntryTime=TimeCurrent();
     Print(BSX_NAME,": GRID fired=",fired,"/",g_gridLevels," ",isBuy?"BUY":"SELL"," step=",g_gridStep,"pts");}
  }

void OpenHedge(int signal, double atrVal)
  {
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double tickSz=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   double tickVal=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   int    digs=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   long   sl0=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long   frz=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double minD=MathMax((double)(sl0+frz+5),10.0)*tickSz;
   double mainLot=CalcLot();
   double hedgeLot=NormalizeLot(mainLot*g_hedgeLotMult);
   double safeMin=MathMax(minD,atrVal*1.5);
   bool isBuy=(signal==1);
   int fired=0;
   double ptM=(tickSz>0&&mainLot>0)?(tickVal/tickSz)*mainLot:1.0;
   double slDM=MathMax(g_slUSD/ptM,safeMin); double tpDM=MathMax(g_tpUSD/ptM,safeMin);
   bool ok=false;
   if(isBuy){double sl=NormalizeDouble(ask-slDM,digs);double tp=NormalizeDouble(ask+tpDM,digs);ok=trade.Buy(mainLot,_Symbol,ask,sl,tp,"HEDGE_MAIN");}
   else     {double sl=NormalizeDouble(bid+slDM,digs);double tp=NormalizeDouble(bid-tpDM,digs);ok=trade.Sell(mainLot,_Symbol,bid,sl,tp,"HEDGE_MAIN");}
   if(ok){fired++;g_totalTrades++;}
   if(CountMyPositions()<g_maxPositions)
     {
      double ptH=(tickSz>0&&hedgeLot>0)?(tickVal/tickSz)*hedgeLot:1.0;
      double slDH=MathMax(g_slUSD/ptH,safeMin); double tpDH=MathMax(g_tpUSD/ptH,safeMin);
      ok=false;
      if(!isBuy){double sl=NormalizeDouble(ask-slDH,digs);double tp=NormalizeDouble(ask+tpDH,digs);ok=trade.Buy(hedgeLot,_Symbol,ask,sl,tp,"HEDGE_OPP");}
      else      {double sl=NormalizeDouble(bid+slDH,digs);double tp=NormalizeDouble(bid-tpDH,digs);ok=trade.Sell(hedgeLot,_Symbol,bid,sl,tp,"HEDGE_OPP");}
      if(ok){fired++;g_totalTrades++;}
     }
   if(fired>0){g_lastEntryTime=TimeCurrent();
     Print(BSX_NAME,": HEDGE fired=",fired," main=",mainLot," opp=",hedgeLot);}
  }

void CheckScale()
  {
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double tickSz=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   double tickVal=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   int    digs=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   long   sl0=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long   frz=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double minD=MathMax((double)(sl0+frz+5),10.0)*tickSz;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol||posInfo.Magic()!=g_magic) continue;
      if(CountMyPositions()>=g_maxPositions) break;
      ulong tk=posInfo.Ticket();
      if(ScaledAlready(tk)) continue;
      double openP=posInfo.PriceOpen();
      double curP=(posInfo.PositionType()==POSITION_TYPE_BUY)?bid:ask;
      double lossPts=(posInfo.PositionType()==POSITION_TYPE_BUY)
                     ?(openP-curP)/tickSz:(curP-openP)/tickSz;
      if(lossPts<g_scaleStep) continue;
      double newLot=NormalizeLot(posInfo.Volume()*g_scaleMult);
      double ptN=(tickSz>0&&newLot>0)?(tickVal/tickSz)*newLot:1.0;
      double slD=MathMax(g_slUSD/ptN,MathMax(minD,10.0*tickSz));
      double tpD=MathMax(g_tpUSD/ptN,MathMax(minD,10.0*tickSz));
      bool ok=false;
      if(posInfo.PositionType()==POSITION_TYPE_BUY)
        {double sl=NormalizeDouble(ask-slD,digs);double tp=NormalizeDouble(ask+tpD,digs);ok=trade.Buy(newLot,_Symbol,ask,sl,tp,"SCALE");}
      else
        {double sl=NormalizeDouble(bid+slD,digs);double tp=NormalizeDouble(bid-tpD,digs);ok=trade.Sell(newLot,_Symbol,bid,sl,tp,"SCALE");}
      if(ok)
        {
         if(g_scaledCount<200) g_scaledFrom[g_scaledCount++]=tk;
         g_totalTrades++; g_lastEntryTime=TimeCurrent();
         Print(BSX_NAME,": SCALE #",tk," lot=",newLot," loss=",DoubleToString(lossPts,0),"pts");
        }
     }
  }

//+------------------------------------------------------------------+
void OpenTrade(const ENUM_ORDER_TYPE type, const double atrVal,
               const double c1, const double h1, const double l1)
  {
   double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double tickSz = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   int    digs   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   sl0    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long   frz    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minD   = MathMax((double)(sl0+frz+5), 10.0) * tickSz;
   double lot    = CalcLot();

   double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double pointVal = (tickSize > 0.0 && lot > 0.0) ? (tickVal / tickSize) * lot : 1.0;
   double safeMin  = MathMax(minD, atrVal * 1.5);
   double slD = MathMax(g_slUSD / pointVal, safeMin);
   double tpD = MathMax(g_tpUSD / pointVal, safeMin);

   MqlDateTime dt; TimeToStruct(TimeGMT(), dt);
   int hr = dt.hour;
   string sess = (hr>=7&&hr<13)?"London":(hr>=13&&hr<22)?"NY":(hr>=0&&hr<7)?"Tokyo":"Off";
   string snap = "RSI="+DoubleToString(g_snapRSI,0)
               +" EMA="+(g_snapEMAUp?"U":"D")
               +" ATR="+DoubleToString(g_snapATR,1)
               +" S="+sess;

   datetime expiry = TimeCurrent() + PeriodSeconds(TF) * 5;
   double entry, sl, tp; bool ok=false;
   string modeTxt="";

   if(g_orderType == 1) // LIMIT
     {
      entry = NormalizeDouble(c1, digs);
      if(type==ORDER_TYPE_BUY)
        { if(entry>=ask) entry=NormalizeDouble(ask-minD,digs);
          sl=NormalizeDouble(entry-slD,digs); tp=NormalizeDouble(entry+tpD,digs);
          ok=trade.BuyLimit(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap);
          modeTxt="BUY_LIMIT"; }
      else
        { if(entry<=bid) entry=NormalizeDouble(bid+minD,digs);
          sl=NormalizeDouble(entry+slD,digs); tp=NormalizeDouble(entry-tpD,digs);
          ok=trade.SellLimit(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap);
          modeTxt="SELL_LIMIT"; }
     }
   else if(g_orderType == 2) // STOP
     {
      double buf=MathMax(tickSz*3,minD);
      if(type==ORDER_TYPE_BUY)
        { entry=NormalizeDouble(h1+buf,digs);
          if(entry<=ask) entry=NormalizeDouble(ask+buf,digs);
          sl=NormalizeDouble(entry-slD,digs); tp=NormalizeDouble(entry+tpD,digs);
          ok=trade.BuyStop(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap);
          modeTxt="BUY_STOP"; }
      else
        { entry=NormalizeDouble(l1-buf,digs);
          if(entry>=bid) entry=NormalizeDouble(bid-buf,digs);
          sl=NormalizeDouble(entry+slD,digs); tp=NormalizeDouble(entry-tpD,digs);
          ok=trade.SellStop(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap);
          modeTxt="SELL_STOP"; }
     }
   else // MARKET
     {
      if(type==ORDER_TYPE_BUY)
        { sl=NormalizeDouble(ask-slD,digs); tp=NormalizeDouble(ask+tpD,digs);
          ok=trade.Buy(lot,_Symbol,ask,sl,tp,snap); modeTxt="BUY_MKT"; }
      else
        { sl=NormalizeDouble(bid+slD,digs); tp=NormalizeDouble(bid-tpD,digs);
          ok=trade.Sell(lot,_Symbol,bid,sl,tp,snap); modeTxt="SELL_MKT"; }
     }

   if(ok)
     { g_lastEntryTime=TimeCurrent(); g_totalTrades++;
       Print(EA_NAME,": ",modeTxt," lot=",lot," TP$=",g_tpUSD," SL$=",g_slUSD); }
   else
     { uint rc=trade.ResultRetcode();
       Print(EA_NAME,": FAIL [",modeTxt,"] ",rc);
       if(g_orderType!=0 && (rc==10044||rc==10018||rc==10019||rc==10034))
         { Print(EA_NAME,": fallback → MARKET");
           if(type==ORDER_TYPE_BUY)
             { double sl2=NormalizeDouble(ask-slD,digs); double tp2=NormalizeDouble(ask+tpD,digs);
               ok=trade.Buy(lot,_Symbol,ask,sl2,tp2,snap); }
           else
             { double sl2=NormalizeDouble(bid+slD,digs); double tp2=NormalizeDouble(bid-tpD,digs);
               ok=trade.Sell(lot,_Symbol,bid,sl2,tp2,snap); }
           if(ok) { g_lastEntryTime=TimeCurrent(); g_totalTrades++;
                    Print(EA_NAME,": MARKET fallback OK"); } } }
  }

//+------------------------------------------------------------------+
void OpenBasket(const ENUM_ORDER_TYPE dir, const double atrVal,
                const double c1, const double h1, const double l1,
                const int slots)
  {
   double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double tickSz = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   int    digs   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   sl0    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long   frz    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minD   = MathMax((double)(sl0+frz+5), 10.0) * tickSz;
   double lot    = CalcLot();

   double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double pointVal = (tickSize>0.0&&lot>0.0) ? (tickVal/tickSize)*lot : 1.0;
   double safeMin  = MathMax(minD, atrVal*1.5);
   double slD = MathMax(EffectiveSL(lot)/pointVal, safeMin);
   double tpD = MathMax(EffectiveTP(lot)/pointVal, safeMin);

   MqlDateTime dt; TimeToStruct(TimeGMT(), dt);
   int hr=dt.hour;
   string sess=(hr>=7&&hr<13)?"London":(hr>=13&&hr<22)?"NY":(hr>=0&&hr<7)?"Tokyo":"Off";
   string snap="RSI="+DoubleToString(g_snapRSI,0)
              +" EMA="+(g_snapEMAUp?"U":"D")
              +" ATR="+DoubleToString(g_snapATR,1)
              +" S="+sess;

   datetime expiry = TimeCurrent() + PeriodSeconds(TF)*5;
   bool isBuy = (dir==ORDER_TYPE_BUY);
   int effectiveSlots = MathMin(slots, 2); // basket max 2 صفقات
   int  fired  = 0;

   long execMode  = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_EXEMODE);
   bool pendingOK = (execMode==SYMBOL_TRADE_EXECUTION_EXCHANGE||
                     execMode==SYMBOL_TRADE_EXECUTION_MARKET);

   // [0] MARKET
   if(slots >= 1)
     { bool ok;
       if(isBuy)
         { double sl=NormalizeDouble(ask-slD,digs); double tp=NormalizeDouble(ask+tpD,digs);
           ok=trade.Buy(lot,_Symbol,ask,sl,tp,snap); }
       else
         { double sl=NormalizeDouble(bid+slD,digs); double tp=NormalizeDouble(bid-tpD,digs);
           ok=trade.Sell(lot,_Symbol,bid,sl,tp,snap); }
       if(ok) { fired++; g_totalTrades++;
                Print(EA_NAME,": BASKET[0] ",isBuy?"BUY":"SELL"," MARKET"); }
       else    Print(EA_NAME,": BASKET[0] FAIL ",trade.ResultRetcode()); }

   // [1] STOP
   if(effectiveSlots>=2 && pendingOK)
     { double buf=MathMax(tickSz*5,minD); bool ok;
       if(isBuy)
         { double entry=NormalizeDouble(h1+buf,digs);
           if(entry<=ask) entry=NormalizeDouble(ask+buf,digs);
           double sl=NormalizeDouble(entry-slD,digs); double tp=NormalizeDouble(entry+tpD,digs);
           ok=trade.BuyStop(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap); }
       else
         { double entry=NormalizeDouble(l1-buf,digs);
           if(entry>=bid) entry=NormalizeDouble(bid-buf,digs);
           double sl=NormalizeDouble(entry+slD,digs); double tp=NormalizeDouble(entry-tpD,digs);
           ok=trade.SellStop(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap); }
       if(ok) { fired++; g_totalTrades++;
                Print(EA_NAME,": BASKET[1] STOP"); }
       else    Print(EA_NAME,": BASKET[1] SKIP (",trade.ResultRetcode(),")"); }

   // [2] LIMIT
   if(false) // disabled — basket max 2
     { bool ok;
       if(isBuy)
         { double entry=NormalizeDouble(c1,digs);
           if(entry>=ask) entry=NormalizeDouble(ask-minD,digs);
           double sl=NormalizeDouble(entry-slD,digs); double tp=NormalizeDouble(entry+tpD,digs);
           ok=trade.BuyLimit(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap); }
       else
         { double entry=NormalizeDouble(c1,digs);
           if(entry<=bid) entry=NormalizeDouble(bid+minD,digs);
           double sl=NormalizeDouble(entry+slD,digs); double tp=NormalizeDouble(entry-tpD,digs);
           ok=trade.SellLimit(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap); }
       if(ok) { fired++; g_totalTrades++;
                Print(EA_NAME,": BASKET[2] LIMIT"); }
       else    Print(EA_NAME,": BASKET[2] SKIP (",trade.ResultRetcode(),")"); }

   if(fired>0)
     { g_lastEntryTime=TimeCurrent();
       Print(EA_NAME,": BASKET fired=",fired,"/3 TP$=",g_tpUSD," SL$=",g_slUSD); }
  }

//+------------------------------------------------------------------+
void ManagePositions()
  {
   datetime now = TimeCurrent();
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol||posInfo.Magic()!=g_magic) continue;
      ulong    tk      = posInfo.Ticket();
      datetime openAt  = (datetime)posInfo.Time();
      double   profit  = posInfo.Profit()+posInfo.Swap()+posInfo.Commission();
      int      ageSec  = (int)(now-openAt);
      double   posLot  = posInfo.Volume();
      double   effTP   = g_tpUSD;
      double   effSL   = g_slUSD;

      // Breakeven: إذا الربح وصل 1.5× SL → نقل الـ SL لنقطة التعادل
      if(profit >= effSL * 1.5)
        {
         double openPrice = posInfo.PriceOpen();
         double bePrice;
         // نضيف buffer صغير (نص الـ spread) لضمان ربح بسيط عند الإغلاق
         double halfSpread = (SymbolInfoDouble(_Symbol,SYMBOL_ASK) - SymbolInfoDouble(_Symbol,SYMBOL_BID)) * 0.5;
         int    digs       = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
         if(posInfo.PositionType() == POSITION_TYPE_BUY)
            bePrice = NormalizeDouble(openPrice + halfSpread, digs);
         else
            bePrice = NormalizeDouble(openPrice - halfSpread, digs);
         double curSL = posInfo.StopLoss();
         // فقط إذا الـ SL الحالي أسوأ من نقطة التعادل
         bool needMove = (posInfo.PositionType()==POSITION_TYPE_BUY  && curSL < bePrice) ||
                         (posInfo.PositionType()==POSITION_TYPE_SELL && (curSL > bePrice || curSL==0));
         if(needMove)
           {
            if(trade.PositionModify(tk, bePrice, posInfo.TakeProfit()))
               Print(EA_NAME,": BE moved — profit=$",DoubleToString(profit,2));
           }
        }

      if(profit >= effTP)
        { trade.PositionClose(tk);
          Print(EA_NAME,": TP $",DoubleToString(profit,2)," (limit $",DoubleToString(effTP,2),")"); continue; }
      if(ageSec >= 60 && profit <= -effSL)
        { trade.PositionClose(tk);
          Print(EA_NAME,": SL $",DoubleToString(profit,2)," (limit $",DoubleToString(effSL,2),")"); continue; }
     }
  }

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &req,
                        const MqlTradeResult &res)
  {
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if(HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=g_magic) return;
   if(HistoryDealGetInteger(trans.deal,DEAL_ENTRY)!=DEAL_ENTRY_OUT) return;
   g_dayPL += HistoryDealGetDouble(trans.deal,DEAL_PROFIT)
            + HistoryDealGetDouble(trans.deal,DEAL_SWAP)
            + HistoryDealGetDouble(trans.deal,DEAL_COMMISSION);
  }

//+------------------------------------------------------------------+
//| Dashboard                                                        |
//+------------------------------------------------------------------+
void DLabel(const string id,const string txt,const int x,const int y,
            const color clr,const int fs=9)
  {
   string nm=DASH_PREFIX+id;
   if(ObjectFind(0,nm)<0)
     { ObjectCreate(0,nm,OBJ_LABEL,0,0,0);
       ObjectSetInteger(0,nm,OBJPROP_CORNER,    CORNER_LEFT_UPPER);
       ObjectSetInteger(0,nm,OBJPROP_BACK,      false);
       ObjectSetInteger(0,nm,OBJPROP_SELECTABLE,false);
       ObjectSetInteger(0,nm,OBJPROP_HIDDEN,    true);
       ObjectSetInteger(0,nm,OBJPROP_ZORDER,    1);
       ObjectSetString (0,nm,OBJPROP_FONT,      "Consolas"); }
   ObjectSetInteger(0,nm,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,nm,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,nm,OBJPROP_COLOR,clr);
   ObjectSetInteger(0,nm,OBJPROP_FONTSIZE,fs);
   ObjectSetString (0,nm,OBJPROP_TEXT,txt);
  }

void DDivider(const string id,const int y)
  {
   string nm=DASH_PREFIX+id;
   if(ObjectFind(0,nm)<0)
     { ObjectCreate(0,nm,OBJ_RECTANGLE_LABEL,0,0,0);
       ObjectSetInteger(0,nm,OBJPROP_CORNER,     CORNER_LEFT_UPPER);
       ObjectSetInteger(0,nm,OBJPROP_XDISTANCE,  PANEL_X+PAD);
       ObjectSetInteger(0,nm,OBJPROP_XSIZE,      PANEL_W-2*PAD);
       ObjectSetInteger(0,nm,OBJPROP_YSIZE,      1);
       ObjectSetInteger(0,nm,OBJPROP_BGCOLOR,    CLR_DIVIDER);
       ObjectSetInteger(0,nm,OBJPROP_BORDER_TYPE,BORDER_FLAT);
       ObjectSetInteger(0,nm,OBJPROP_COLOR,      CLR_DIVIDER);
       ObjectSetInteger(0,nm,OBJPROP_BACK,       false);
       ObjectSetInteger(0,nm,OBJPROP_SELECTABLE, false);
       ObjectSetInteger(0,nm,OBJPROP_HIDDEN,     true);
       ObjectSetInteger(0,nm,OBJPROP_ZORDER,     1); }
   ObjectSetInteger(0,nm,OBJPROP_YDISTANCE,y);
  }

//+------------------------------------------------------------------+
void CreateDashboard()
  {
   int panelH=PAD+TITLE_H+5*8+17*ROW_H+PAD;
   string bg=DASH_PREFIX+"BG";
   if(ObjectFind(0,bg)<0)
      ObjectCreate(0,bg,OBJ_RECTANGLE_LABEL,0,0,0);
   ObjectSetInteger(0,bg,OBJPROP_CORNER,     CORNER_LEFT_UPPER);
   ObjectSetInteger(0,bg,OBJPROP_XDISTANCE,  PANEL_X);
   ObjectSetInteger(0,bg,OBJPROP_YDISTANCE,  PANEL_Y);
   ObjectSetInteger(0,bg,OBJPROP_XSIZE,      PANEL_W);
   ObjectSetInteger(0,bg,OBJPROP_YSIZE,      panelH);
   ObjectSetInteger(0,bg,OBJPROP_BGCOLOR,    CLR_BG);
   ObjectSetInteger(0,bg,OBJPROP_BORDER_TYPE,BORDER_FLAT);
   ObjectSetInteger(0,bg,OBJPROP_COLOR,      C'0,150,255'); // أزرق للبتكوين
   ObjectSetInteger(0,bg,OBJPROP_WIDTH,      1);
   ObjectSetInteger(0,bg,OBJPROP_BACK,       false);
   ObjectSetInteger(0,bg,OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0,bg,OBJPROP_HIDDEN,     true);
   ObjectSetInteger(0,bg,OBJPROP_ZORDER,     0);

   int xK=PANEL_X+PAD; int y=PANEL_Y+PAD;
   DLabel("TITLE",EA_NAME+" v"+EA_VERSION+"  "+_Symbol,xK,y,C'0,200,255',10);
   y+=TITLE_H; DDivider("D0",y); y+=8;

   DLabel("K_MAGIC", "Magic",     xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_TREND", "Trend",     xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_RSI",   "RSI(7)",    xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D1",y); y+=8;
   DLabel("K_SESS",  "Hours",     xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_SIG",   "Signal",    xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_ENTRY", "Entry",     xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D2",y); y+=8;
   DLabel("K_POS",   "Positions", xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_PNL",   "Float P&L", xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_DAYPNL","Day P&L",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_TRADES","Trades",    xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D3",y); y+=8;
   DLabel("K_LOT",   "Lot",       xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_TPSL",  "TP$/SL$",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_DLOSS", "MaxLoss$",  xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_DPROF", "MaxProfit$",xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D4",y); y+=8;
   DLabel("K_SPREAD","Spread",    xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_ATR",   "ATR(14)",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_ORDTYP","OrderType", xK,y,CLR_KEY);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
void UpdateDashboard(const int trend,const double rsi,
                     const bool sessOK,const int signal,
                     const bool blocked,const int cdSec,
                     const int posCount,const double atrVal,
                     const long spreadPts)
  {
   int xV=PANEL_X+140; int y=PANEL_Y+PAD+TITLE_H+8;

   DLabel("V_MAGIC",(string)g_magic,xV,y,CLR_HILITE); y+=ROW_H;

   string tTxt=trend>0?"UP ▲":trend<0?"DOWN ▼":"FLAT";
   color  tClr=trend>0?CLR_GOOD:trend<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_TREND",tTxt,xV,y,tClr); y+=ROW_H;

   color rClr=rsi>=70?CLR_BAD:rsi<=30?CLR_GOOD:CLR_NEUTRAL;
   DLabel("V_RSI",DoubleToString(rsi,1),xV,y,rClr); y+=ROW_H+8;

   bool dayHit=DayLimitHit();
   string sessStr=dayHit?"DAY LIMIT":(sessOK?"ACTIVE":"CLOSED");
   color  sessClr=dayHit?CLR_BAD:(sessOK?CLR_GOOD:CLR_BAD);
   DLabel("V_SESS",sessStr,xV,y,sessClr); y+=ROW_H;

   string sTxt=signal>0?"BUY ▲":signal<0?"SELL ▼":"NONE";
   color  sClr=signal>0?CLR_GOOD:signal<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_SIG",sTxt,xV,y,sClr); y+=ROW_H;

   string eTxt; color eClr;
   if(blocked)     {eTxt="BLOCKED";              eClr=CLR_BAD;}
   else if(cdSec>0){eTxt="CD "+string(cdSec)+"s";eClr=clrOrange;}
   else            {eTxt="READY";                eClr=CLR_GOOD;}
   DLabel("V_ENTRY",eTxt,xV,y,eClr); y+=ROW_H+8;

   color pClr=posCount>=g_maxPositions?CLR_BAD:CLR_HILITE;
   DLabel("V_POS",string(posCount)+" / "+string(g_maxPositions),xV,y,pClr); y+=ROW_H;

   double pl=MyFloatingPL();
   color  plClr=pl>0?CLR_GOOD:pl<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_PNL",(pl>=0?"+":"")+DoubleToString(pl,2),xV,y,plClr); y+=ROW_H;

   color dpClr=g_dayPL>0?CLR_GOOD:g_dayPL<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_DAYPNL",(g_dayPL>=0?"+":"")+DoubleToString(g_dayPL,2),xV,y,dpClr); y+=ROW_H;
   DLabel("V_TRADES",string(g_totalTrades),xV,y,CLR_NEUTRAL); y+=ROW_H+8;

   DLabel("V_LOT",DoubleToString(g_lot,2),xV,y,CLR_HILITE); y+=ROW_H;
   string tpslTxt="$"+DoubleToString(g_tpUSD,2)+" / $"+DoubleToString(g_slUSD,2);

   color btcBlue=C'0,150,255';
   DLabel("V_TPSL",tpslTxt,xV,y,CLR_HILITE); y+=ROW_H;

   bool lossNear=(g_dayPL<=-g_maxLossPerDay*0.8);
   DLabel("V_DLOSS","$"+DoubleToString(g_maxLossPerDay,2),xV,y,lossNear?CLR_BAD:CLR_NEUTRAL); y+=ROW_H;
   bool profNear=(g_maxProfitPerDay>0&&g_dayPL>=g_maxProfitPerDay*0.8);
   DLabel("V_DPROF","$"+DoubleToString(g_maxProfitPerDay,2),xV,y,profNear?CLR_GOOD:CLR_NEUTRAL); y+=ROW_H+8;

   color spClr=spreadPts>(long)g_maxSpread?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_SPREAD",string(spreadPts)+" pts",xV,y,spClr); y+=ROW_H;
   DLabel("V_ATR",DoubleToString(atrVal,_Digits),xV,y,CLR_HILITE); y+=ROW_H;

   string otTxt=g_orderType==3?"BASKET":g_orderType==1?"LIMIT":g_orderType==2?"STOP":"MARKET";
   color  otClr=g_orderType==3?clrGold:g_orderType==1?clrDodgerBlue:g_orderType==2?clrOrange:CLR_GOOD;
   DLabel("V_ORDTYP",otTxt,xV,y,otClr); y+=ROW_H;

   double h1e[];
   ArraySetAsSeries(h1e,true);
   string h1Txt="H1: --"; color h1Clr=CLR_NEUTRAL;
   if(!g_useH1Filter)
     { h1Txt="H1 FILTER: OFF"; h1Clr=clrOrange; }
   else if(CopyBuffer(hH1EMA,0,0,3,h1e)>=3)
     { bool up=h1e[1]>=h1e[2];
       h1Txt=up?"H1 BIAS: ↑ BUY":"H1 BIAS: ↓ SELL";
       h1Clr=up?CLR_GOOD:CLR_BAD; }
   DLabel("V_H1BIAS",h1Txt,xV,y,h1Clr);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
