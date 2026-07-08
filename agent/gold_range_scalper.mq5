//+------------------------------------------------------------------+
//|                                        GoldRangeScalper v3.00   |
//|     HFT — كل صفقة مراقبة بشكل مستقل (بدون سلة)                 |
//+------------------------------------------------------------------+
#property copyright "GRS"
#property version   "3.00"
#property strict

#include <Trade\Trade.mqh>

//--- inputs
input double   BaseLot      = 0.11;  // حجم اللوت
input double   TradeTP      = 3.0;   // ربح كل صفقة بالدولار
input double   TradeSL      = 5.0;   // خسارة كل صفقة بالدولار
input double   MaxSpread    = 350.0; // أقصى سبريد
input int      CooldownBars = 1;     // بارات انتظار بعد إغلاق
input int      MaxTrades    = 20;    // أقصى عدد صفقات مفتوحة في كل اتجاه
input int      MagicBuy     = 88801; // Magic BUY
input int      MagicSell    = 88802; // Magic SELL

//--- EA identity
#define EA_NAME       "GRX"
#define EA_VERSION    "3.00"
#define SETTINGS_FILE "GRX_Settings.json"
#define LOG_FILE      "GRX_Log.txt"
#define DASH_PREFIX   "GRX_D_"
#define BB_PFX        "GRX_BB_"
#define BB_BARS       120
#define PANEL_X       10
#define PANEL_Y       230
#define ROW_H         16
#define CLR_KEY       clrSilver

CTrade trade;

//--- globals من الإعدادات
double g_lot        = 0.11;
double g_tradeTP    = 3.0;
double g_tradeSL    = 5.0;
double g_maxSpread  = 350.0;
int    g_cooldown   = 1;
int    g_maxTrades  = 20;
bool   g_running    = true;
int    g_magicBuy   = MagicBuy;
int    g_magicSell  = MagicSell;
string g_lastHash   = "";

//--- cooldown لكل اتجاه
int g_buyCooldown  = 0;
int g_sellCooldown = 0;

//--- state
datetime g_lastBar = 0;
int      g_hBB     = INVALID_HANDLE;

//===================================================================
//  LOG
//===================================================================
void EALog(string msg)
  {
   string line = TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES|TIME_SECONDS)
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

//===================================================================
//  SETTINGS
//===================================================================
double ReadSetting(string key, double def)
  {
   int fh = FileOpen(SETTINGS_FILE, FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return def;
   string content = "";
   while(!FileIsEnding(fh)) content += FileReadString(fh);
   FileClose(fh);
   int p = StringFind(content, "\"" + key + "\"");
   if(p < 0) return def;
   int c = StringFind(content, ":", p);
   if(c < 0) return def;
   string rest = StringSubstr(content, c + 1);
   StringTrimLeft(rest); StringTrimRight(rest);
   return StringToDouble(rest);
  }

void WriteDefaultSettings()
  {
   int fh = FileOpen(SETTINGS_FILE, FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh != INVALID_HANDLE) { FileClose(fh); return; }
   fh = FileOpen(SETTINGS_FILE, FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return;
   string j = "{\"BaseLot\":0.11,\"TradeTP\":3.0,\"TradeSL\":5.0,\"MaxSpread\":350,"
              "\"CooldownBars\":1,\"MaxTrades\":20,\"BotRunning\":1}";
   FileWriteString(fh, j);
   FileClose(fh);
  }

void LoadSettings()
  {
   string content = "";
   int fh = FileOpen(SETTINGS_FILE, FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return;
   while(!FileIsEnding(fh)) content += FileReadString(fh);
   FileClose(fh);
   string newHash = content;
   if(newHash == g_lastHash) return;
   g_lastHash = newHash;

   g_lot       = ReadSetting("BaseLot",      BaseLot);
   g_tradeTP   = ReadSetting("TradeTP",      TradeTP);
   g_tradeSL   = ReadSetting("TradeSL",      TradeSL);
   g_maxSpread = ReadSetting("MaxSpread",    MaxSpread);
   g_cooldown  = (int)ReadSetting("CooldownBars", CooldownBars);
   g_maxTrades = (int)ReadSetting("MaxTrades",    MaxTrades);
   g_running   = ReadSetting("BotRunning",   1.0) > 0;
  }

//===================================================================
//  COUNT POSITIONS
//===================================================================
int CountByMagic(int magic)
  {
   int n = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((int)PositionGetInteger(POSITION_MAGIC) == magic) n++;
     }
   return n;
  }

//===================================================================
//  MONITOR — يراقب كل صفقة بشكل مستقل
//===================================================================
void MonitorTrades()
  {
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;

      int magic = (int)PositionGetInteger(POSITION_MAGIC);
      if(magic != g_magicBuy && magic != g_magicSell) continue;

      double profit = PositionGetDouble(POSITION_PROFIT);
      string side   = magic == g_magicBuy ? "BUY" : "SELL";

      if(profit >= g_tradeTP)
        {
         trade.PositionClose(ticket, 500);
         EALog("CLOSE " + side + " #" + IntegerToString(ticket)
               + " TP +" + DoubleToString(profit, 2));
         if(magic == g_magicBuy)  g_buyCooldown  = g_cooldown;
         if(magic == g_magicSell) g_sellCooldown = g_cooldown;
        }
      else if(profit <= -g_tradeSL)
        {
         trade.PositionClose(ticket, 500);
         EALog("CLOSE " + side + " #" + IntegerToString(ticket)
               + " SL " + DoubleToString(profit, 2));
        }
     }
  }

//===================================================================
//  OPEN TRADE
//===================================================================
void OpenTrade(int signal, int magic)
  {
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > g_maxSpread) return;

   string tag = magic == g_magicBuy ? "GRX_BUY" : "GRX_SELL";
   trade.SetExpertMagicNumber(magic);

   bool ok = false;
   if(signal == 1)
      ok = trade.Buy(g_lot, _Symbol, SymbolInfoDouble(_Symbol, SYMBOL_ASK), 0, 0, tag);
   else
      ok = trade.Sell(g_lot, _Symbol, SymbolInfoDouble(_Symbol, SYMBOL_BID), 0, 0, tag);

   if(ok) EALog("OPEN " + tag + " lot=" + DoubleToString(g_lot, 2));
  }

//===================================================================
//  RSI
//===================================================================
int GetRSISignal()
  {
   int hRSI = iRSI(_Symbol, PERIOD_M1, 14, PRICE_CLOSE);
   if(hRSI == INVALID_HANDLE) return 0;
   double rsi[];
   ArraySetAsSeries(rsi, true);
   int copied = CopyBuffer(hRSI, 0, 1, 1, rsi);
   IndicatorRelease(hRSI);
   if(copied < 1) return 0;
   if(rsi[0] > 70) return -1; // مبيع زيادة → لا BUY
   if(rsi[0] < 30) return  1; // مشتري زيادة → لا SELL
   return 0; // عادي → الاثنين مسموح
  }

//===================================================================
//  BOLLINGER BANDS على الشارت
//===================================================================
void DrawBBLines()
  {
   if(g_hBB == INVALID_HANDLE) return;
   double upper[], lower[], mid[];
   datetime t[];
   ArraySetAsSeries(upper,true); ArraySetAsSeries(lower,true);
   ArraySetAsSeries(mid,true);   ArraySetAsSeries(t,true);
   if(CopyBuffer(g_hBB,1,0,BB_BARS+1,upper)<BB_BARS+1) return;
   if(CopyBuffer(g_hBB,2,0,BB_BARS+1,lower)<BB_BARS+1) return;
   if(CopyBuffer(g_hBB,0,0,BB_BARS+1,mid)  <BB_BARS+1) return;
   if(CopyTime(_Symbol,PERIOD_M1,0,BB_BARS+1,t)<BB_BARS+1) return;

   for(int i=BB_BARS-1;i>=0;i--)
     {
      string su=BB_PFX+"U"+IntegerToString(i);
      string sl=BB_PFX+"L"+IntegerToString(i);
      string sm=BB_PFX+"M"+IntegerToString(i);

      if(ObjectFind(0,su)<0) ObjectCreate(0,su,OBJ_TREND,0,0,0,0,0);
      ObjectSetInteger(0,su,OBJPROP_TIME,0,t[i+1]); ObjectSetDouble(0,su,OBJPROP_PRICE,0,upper[i+1]);
      ObjectSetInteger(0,su,OBJPROP_TIME,1,t[i]);   ObjectSetDouble(0,su,OBJPROP_PRICE,1,upper[i]);
      ObjectSetInteger(0,su,OBJPROP_COLOR,clrRed); ObjectSetInteger(0,su,OBJPROP_WIDTH,2);
      ObjectSetInteger(0,su,OBJPROP_RAY_RIGHT,false); ObjectSetInteger(0,su,OBJPROP_SELECTABLE,false);

      if(ObjectFind(0,sl)<0) ObjectCreate(0,sl,OBJ_TREND,0,0,0,0,0);
      ObjectSetInteger(0,sl,OBJPROP_TIME,0,t[i+1]); ObjectSetDouble(0,sl,OBJPROP_PRICE,0,lower[i+1]);
      ObjectSetInteger(0,sl,OBJPROP_TIME,1,t[i]);   ObjectSetDouble(0,sl,OBJPROP_PRICE,1,lower[i]);
      ObjectSetInteger(0,sl,OBJPROP_COLOR,clrLime); ObjectSetInteger(0,sl,OBJPROP_WIDTH,2);
      ObjectSetInteger(0,sl,OBJPROP_RAY_RIGHT,false); ObjectSetInteger(0,sl,OBJPROP_SELECTABLE,false);

      if(ObjectFind(0,sm)<0) ObjectCreate(0,sm,OBJ_TREND,0,0,0,0,0);
      ObjectSetInteger(0,sm,OBJPROP_TIME,0,t[i+1]); ObjectSetDouble(0,sm,OBJPROP_PRICE,0,mid[i+1]);
      ObjectSetInteger(0,sm,OBJPROP_TIME,1,t[i]);   ObjectSetDouble(0,sm,OBJPROP_PRICE,1,mid[i]);
      ObjectSetInteger(0,sm,OBJPROP_COLOR,clrDodgerBlue); ObjectSetInteger(0,sm,OBJPROP_WIDTH,1);
      ObjectSetInteger(0,sm,OBJPROP_STYLE,STYLE_DOT);
      ObjectSetInteger(0,sm,OBJPROP_RAY_RIGHT,false); ObjectSetInteger(0,sm,OBJPROP_SELECTABLE,false);
     }

   string lU=BB_PFX+"LBL_U", lL=BB_PFX+"LBL_L";
   if(ObjectFind(0,lU)<0) ObjectCreate(0,lU,OBJ_TEXT,0,0,0);
   ObjectSetInteger(0,lU,OBJPROP_TIME,t[0]); ObjectSetDouble(0,lU,OBJPROP_PRICE,upper[0]);
   ObjectSetString(0,lU,OBJPROP_TEXT," SELL "+DoubleToString(upper[0],2));
   ObjectSetInteger(0,lU,OBJPROP_COLOR,clrDodgerBlue); ObjectSetInteger(0,lU,OBJPROP_FONTSIZE,8);

   if(ObjectFind(0,lL)<0) ObjectCreate(0,lL,OBJ_TEXT,0,0,0);
   ObjectSetInteger(0,lL,OBJPROP_TIME,t[0]); ObjectSetDouble(0,lL,OBJPROP_PRICE,lower[0]);
   ObjectSetString(0,lL,OBJPROP_TEXT," BUY "+DoubleToString(lower[0],2));
   ObjectSetInteger(0,lL,OBJPROP_COLOR,clrDodgerBlue); ObjectSetInteger(0,lL,OBJPROP_FONTSIZE,8);
   ChartRedraw(0);
  }

//===================================================================
//  DASHBOARD
//===================================================================
void DLabel(string name, string txt, int x, int y, color clr)
  {
   string n = DASH_PREFIX + name;
   if(ObjectFind(0,n)<0)
     {
      ObjectCreate(0,n,OBJ_LABEL,0,0,0);
      ObjectSetInteger(0,n,OBJPROP_CORNER,CORNER_LEFT_UPPER);
      ObjectSetInteger(0,n,OBJPROP_FONTSIZE,8);
      ObjectSetString(0,n,OBJPROP_FONT,"Consolas");
     }
   ObjectSetString(0,n,OBJPROP_TEXT,txt);
   ObjectSetInteger(0,n,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,n,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,n,OBJPROP_COLOR,clr);
  }

void UpdateDashboard()
  {
   int buyN  = CountByMagic(g_magicBuy);
   int sellN = CountByMagic(g_magicSell);
   double buyProfit = 0, sellProfit = 0;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong t=PositionGetTicket(i);
      if(t==0) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
      int m=(int)PositionGetInteger(POSITION_MAGIC);
      if(m==g_magicBuy)  buyProfit  += PositionGetDouble(POSITION_PROFIT);
      if(m==g_magicSell) sellProfit += PositionGetDouble(POSITION_PROFIT);
     }

   int x=PANEL_X, xV=PANEL_X+110, y=PANEL_Y;
   DLabel("TITLE", "⬦ GRX v3.00", x, y, clrGold); y+=ROW_H;
   DLabel("K_TP",  "TradeTP:",  x, y, CLR_KEY);
   DLabel("V_TP",  "$"+DoubleToString(g_tradeTP,1), xV, y, clrWhite); y+=ROW_H;
   DLabel("K_SL",  "TradeSL:",  x, y, CLR_KEY);
   DLabel("V_SL",  "$"+DoubleToString(g_tradeSL,1), xV, y, clrWhite); y+=ROW_H;
   DLabel("K_BN",  "BUY open:", x, y, CLR_KEY);
   DLabel("V_BN",  IntegerToString(buyN)+"  $"+DoubleToString(buyProfit,2),
          xV, y, buyProfit>=0?clrLime:clrRed); y+=ROW_H;
   DLabel("K_SN",  "SELL open:",x, y, CLR_KEY);
   DLabel("V_SN",  IntegerToString(sellN)+"  $"+DoubleToString(sellProfit,2),
          xV, y, sellProfit>=0?clrLime:clrRed); y+=ROW_H;
   DLabel("K_ST",  "Status:",   x, y, CLR_KEY);
   DLabel("V_ST",  g_running?"RUNNING":"STOPPED", xV, y, g_running?clrLime:clrGray);
   ChartRedraw(0);
  }

//===================================================================
//  INIT / DEINIT
//===================================================================
int OnInit()
  {
   trade.SetDeviationInPoints(30);
   trade.SetTypeFilling(ORDER_FILLING_IOC);
   WriteDefaultSettings();
   LoadSettings();
   EventSetTimer(5);
   g_hBB = iBands(_Symbol, PERIOD_M1, 20, 0, 2.0, PRICE_CLOSE);
   EALog("Init v" + EA_VERSION);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(g_hBB != INVALID_HANDLE) IndicatorRelease(g_hBB);
   ObjectsDeleteAll(0, DASH_PREFIX);
   ObjectsDeleteAll(0, BB_PFX);
   EALog("Deinit reason=" + IntegerToString(reason));
  }

void OnTimer()
  {
   LoadSettings();
   UpdateDashboard();
  }

//===================================================================
//  ON TICK
//===================================================================
void OnTick()
  {
   LoadSettings();
   if(!g_running) return;

   // ── مراقبة كل صفقة بشكل مستقل ────────────────────────────────
   MonitorTrades();

   UpdateDashboard();

   // ── بار جديد فقط ──────────────────────────────────────────────
   datetime barTime = iTime(_Symbol, PERIOD_M1, 0);
   if(barTime == g_lastBar) return;
   g_lastBar = barTime;

   if(g_buyCooldown  > 0) g_buyCooldown--;
   if(g_sellCooldown > 0) g_sellCooldown--;
   DrawBBLines();

   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > g_maxSpread) return;

   // ── RSI فلتر ──────────────────────────────────────────────────
   bool allowBuy  = true;
   bool allowSell = true;
   int hRSI = iRSI(_Symbol, PERIOD_M1, 14, PRICE_CLOSE);
   if(hRSI != INVALID_HANDLE)
     {
      double rsi[];
      ArraySetAsSeries(rsi, true);
      if(CopyBuffer(hRSI, 0, 1, 1, rsi) >= 1)
        {
         if(rsi[0] > 70) allowBuy  = false;
         if(rsi[0] < 30) allowSell = false;
        }
      IndicatorRelease(hRSI);
     }

   // ── فتح صفقة BUY ──────────────────────────────────────────────
   if(allowBuy && g_buyCooldown == 0 && CountByMagic(g_magicBuy) < g_maxTrades)
      OpenTrade(1, g_magicBuy);

   // ── فتح صفقة SELL ─────────────────────────────────────────────
   if(allowSell && g_sellCooldown == 0 && CountByMagic(g_magicSell) < g_maxTrades)
      OpenTrade(-1, g_magicSell);
  }
//+------------------------------------------------------------------+
