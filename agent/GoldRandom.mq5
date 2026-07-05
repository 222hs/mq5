//+------------------------------------------------------------------+
//|                                                  GoldRandom.mq5  |
//|                   GoldScalperX — عشوائي BUY/SELL بالتناوب        |
//|                   يقرأ إعداداته من GSX_Settings.json             |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "11.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- ═══ إعدادات افتراضية (تُستبدل من JSON) ═══
input double          InpLotSize        = 0.5;   // LotSize
input int             InpTP             = 100;   // TP_Points (نقاط)
input int             InpSL             = 200;   // SL_Points (نقاط)
input int             InpMaxSpread      = 350;   // MaxSpread
input int             InpMaxPositions   = 1;     // MaxPositions
input int             InpCooldownSecs   = 0;     // CooldownSecs
input double          InpMaxLossPerDay  = 50.0;  // MaxLossPerDay ($)
input double          InpMaxProfitPerDay= 200.0; // MaxProfitPerDay ($)
input int             InpTradeHoursStart= 0;     // TradeHoursStart
input int             InpTradeHoursEnd  = 23;    // TradeHoursEnd
input ENUM_TIMEFRAMES InpTF             = PERIOD_M1;
input int             InpMagic          = 99301;

#define SETTINGS_FILE "GSX_Settings.json"

//--- panel
#define DASH_PREFIX  "GR_"
#define PANEL_X   10
#define PANEL_Y   10
#define PANEL_W   300
#define PAD       18
#define ROW_H     22
#define TITLE_H   28
#define CLR_BG      C'15,15,25'
#define CLR_BORDER  clrDimGray
#define CLR_DIVIDER C'55,55,75'
#define CLR_KEY     C'130,130,155'
#define CLR_GOOD    clrLime
#define CLR_BAD     clrOrangeRed
#define CLR_HILITE  clrDeepSkyBlue
#define CLR_NEUTRAL clrSilver

//--- globals
CTrade        trade;
CPositionInfo posInfo;

datetime g_lastBar       = 0;
datetime g_lastEntryTime = 0;
bool     g_lastWasBuy    = false;
int      g_totalTrades   = 0;
int      g_wins          = 0;
int      g_losses        = 0;
double   g_totalPL       = 0.0;
double   g_dayPL         = 0.0;
string   g_today         = "";

//--- runtime settings (loaded from JSON)
double g_lot;
int    g_tp;
int    g_sl;
double g_maxSpread;
int    g_maxPositions;
int    g_cooldownSecs;
double g_maxLossPerDay;
double g_maxProfitPerDay;
int    g_tradeHoursStart;
int    g_tradeHoursEnd;
bool   g_botRunning;

//+------------------------------------------------------------------+
double ReadJsonDouble(const string key, const double fallback)
  {
   int fh = FileOpen(SETTINGS_FILE, FILE_READ|FILE_TXT|FILE_COMMON);
   if(fh == INVALID_HANDLE) return fallback;
   string content = "";
   while(!FileIsEnding(fh)) content += FileReadString(fh);
   FileClose(fh);
   string search = "\"" + key + "\"";
   int pos = StringFind(content, search);
   if(pos < 0) return fallback;
   pos += StringLen(search);
   while(pos < StringLen(content) && (StringGetCharacter(content,pos)==' ' ||
         StringGetCharacter(content,pos)==':' || StringGetCharacter(content,pos)=='\t'))
      pos++;
   string num = "";
   while(pos < StringLen(content))
     {
      ushort c = StringGetCharacter(content, pos);
      if(c=='-'||c=='.'||(c>='0'&&c<='9')) { num+=ShortToString(c); pos++; }
      else break;
     }
   return StringLen(num)==0 ? fallback : StringToDouble(num);
  }

void LoadSettings()
  {
   g_lot             = ReadJsonDouble("LotSize",         InpLotSize);
   g_tp              = (int)ReadJsonDouble("TP_Points",  InpTP);
   g_sl              = (int)ReadJsonDouble("SL_Points",  InpSL);
   g_maxSpread       = ReadJsonDouble("MaxSpread",       InpMaxSpread);
   g_maxPositions    = (int)ReadJsonDouble("MaxPositions",  InpMaxPositions);
   g_cooldownSecs    = (int)ReadJsonDouble("CooldownSecs",  InpCooldownSecs);
   g_maxLossPerDay   = ReadJsonDouble("MaxLossPerDay",   InpMaxLossPerDay);
   g_maxProfitPerDay = ReadJsonDouble("MaxProfitPerDay", InpMaxProfitPerDay);
   g_tradeHoursStart = (int)ReadJsonDouble("TradeHoursStart", InpTradeHoursStart);
   g_tradeHoursEnd   = (int)ReadJsonDouble("TradeHoursEnd",   InpTradeHoursEnd);
   g_botRunning      = (ReadJsonDouble("BotRunning", 1.0) > 0.5);
  }

//+------------------------------------------------------------------+
void OnTimer() { LoadSettings(); }

//+------------------------------------------------------------------+
bool InTradingHours()
  {
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   if(g_tradeHoursStart <= g_tradeHoursEnd)
      return (h >= g_tradeHoursStart && h < g_tradeHoursEnd);
   else
      return (h >= g_tradeHoursStart || h < g_tradeHoursEnd);
  }

bool DayLimitHit()
  {
   string today = TimeToString(TimeCurrent(), TIME_DATE);
   if(today != g_today) { g_today = today; g_dayPL = 0.0; }
   if(g_maxLossPerDay   > 0 && g_dayPL <= -g_maxLossPerDay)   return true;
   if(g_maxProfitPerDay > 0 && g_dayPL >=  g_maxProfitPerDay) return true;
   return false;
  }

//+------------------------------------------------------------------+
int CountPos()
  {
   int n=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==InpMagic) n++;
   return n;
  }

double FloatPL()
  {
   double pl=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==InpMagic)
            pl += posInfo.Profit()+posInfo.Swap();
   return pl;
  }

double NormLot(double lot)
  {
   double mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double mx=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(st>0) lot=MathFloor(lot/st)*st;
   return MathMax(mn,MathMin(mx,lot));
  }

void OpenTrade(ENUM_ORDER_TYPE type)
  {
   double tickSz = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   long   sl0    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minD   = MathMax((double)(sl0+10), 20.0) * tickSz;
   double tpD    = MathMax(g_tp * tickSz, minD);
   double slD    = MathMax(g_sl * tickSz, minD);
   int    digs   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double lot    = NormLot(g_lot);

   double price, sl, tp;
   if(type==ORDER_TYPE_BUY)
     { price=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
       sl=NormalizeDouble(price-slD,digs);
       tp=NormalizeDouble(price+tpD,digs); }
   else
     { price=SymbolInfoDouble(_Symbol,SYMBOL_BID);
       sl=NormalizeDouble(price+slD,digs);
       tp=NormalizeDouble(price-tpD,digs); }

   long fillMode=SymbolInfoInteger(_Symbol,SYMBOL_FILLING_MODE);
   ENUM_ORDER_TYPE_FILLING fill;
   if((fillMode&SYMBOL_FILLING_FOK)!=0)      fill=ORDER_FILLING_FOK;
   else if((fillMode&SYMBOL_FILLING_IOC)!=0) fill=ORDER_FILLING_IOC;
   else                                       fill=ORDER_FILLING_RETURN;

   MqlTradeRequest req={}; MqlTradeResult res={};
   req.action=TRADE_ACTION_DEAL; req.symbol=_Symbol;
   req.volume=lot; req.type=type; req.price=price;
   req.sl=sl; req.tp=tp; req.deviation=50;
   req.magic=InpMagic; req.type_filling=fill;
   req.comment=(type==ORDER_TYPE_BUY)?"GR_BUY":"GR_SEL";

   if(OrderSend(req,res))
     { g_lastWasBuy=(type==ORDER_TYPE_BUY);
       g_lastEntryTime=TimeCurrent();
       g_totalTrades++;
       Print("GoldRandom: ",(type==ORDER_TYPE_BUY?"BUY":"SELL"),
             " #",res.order," tp=",tp," sl=",sl); }
   else
      Print("GoldRandom: error ",GetLastError()," / ",res.retcode);
  }

//+------------------------------------------------------------------+
// Dashboard helpers
//+------------------------------------------------------------------+
void DLabel(string id,string txt,int x,int y,color clr,int fs=9)
  {
   string nm=DASH_PREFIX+id;
   if(ObjectFind(0,nm)<0)
     {
      ObjectCreate(0,nm,OBJ_LABEL,0,0,0);
      ObjectSetInteger(0,nm,OBJPROP_CORNER,CORNER_LEFT_UPPER);
      ObjectSetInteger(0,nm,OBJPROP_BACK,false);
      ObjectSetInteger(0,nm,OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0,nm,OBJPROP_HIDDEN,true);
      ObjectSetInteger(0,nm,OBJPROP_ZORDER,1);
      ObjectSetString(0,nm,OBJPROP_FONT,"Consolas");
     }
   ObjectSetInteger(0,nm,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,nm,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,nm,OBJPROP_COLOR,clr);
   ObjectSetInteger(0,nm,OBJPROP_FONTSIZE,fs);
   ObjectSetString(0,nm,OBJPROP_TEXT,txt);
  }

void DDivider(string id,int y)
  {
   string nm=DASH_PREFIX+id;
   if(ObjectFind(0,nm)<0)
     {
      ObjectCreate(0,nm,OBJ_RECTANGLE_LABEL,0,0,0);
      ObjectSetInteger(0,nm,OBJPROP_CORNER,CORNER_LEFT_UPPER);
      ObjectSetInteger(0,nm,OBJPROP_XDISTANCE,PANEL_X+PAD);
      ObjectSetInteger(0,nm,OBJPROP_XSIZE,PANEL_W-2*PAD);
      ObjectSetInteger(0,nm,OBJPROP_YSIZE,1);
      ObjectSetInteger(0,nm,OBJPROP_BGCOLOR,CLR_DIVIDER);
      ObjectSetInteger(0,nm,OBJPROP_BORDER_TYPE,BORDER_FLAT);
      ObjectSetInteger(0,nm,OBJPROP_COLOR,CLR_DIVIDER);
      ObjectSetInteger(0,nm,OBJPROP_BACK,false);
      ObjectSetInteger(0,nm,OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0,nm,OBJPROP_HIDDEN,true);
      ObjectSetInteger(0,nm,OBJPROP_ZORDER,1);
     }
   ObjectSetInteger(0,nm,OBJPROP_YDISTANCE,y);
  }

void CreateDashboard()
  {
   int panH=PAD+TITLE_H+8+14*ROW_H+4*8+PAD;
   string bg=DASH_PREFIX+"BG";
   if(ObjectFind(0,bg)<0) ObjectCreate(0,bg,OBJ_RECTANGLE_LABEL,0,0,0);
   ObjectSetInteger(0,bg,OBJPROP_CORNER,CORNER_LEFT_UPPER);
   ObjectSetInteger(0,bg,OBJPROP_XDISTANCE,PANEL_X);
   ObjectSetInteger(0,bg,OBJPROP_YDISTANCE,PANEL_Y);
   ObjectSetInteger(0,bg,OBJPROP_XSIZE,PANEL_W);
   ObjectSetInteger(0,bg,OBJPROP_YSIZE,panH);
   ObjectSetInteger(0,bg,OBJPROP_BGCOLOR,CLR_BG);
   ObjectSetInteger(0,bg,OBJPROP_BORDER_TYPE,BORDER_FLAT);
   ObjectSetInteger(0,bg,OBJPROP_COLOR,CLR_BORDER);
   ObjectSetInteger(0,bg,OBJPROP_WIDTH,1);
   ObjectSetInteger(0,bg,OBJPROP_BACK,false);
   ObjectSetInteger(0,bg,OBJPROP_SELECTABLE,false);
   ObjectSetInteger(0,bg,OBJPROP_HIDDEN,true);
   ObjectSetInteger(0,bg,OBJPROP_ZORDER,0);

   int xK=PANEL_X+PAD; int y=PANEL_Y+PAD;
   DLabel("TITLE","GoldRandom v11.00  "+_Symbol,xK,y,clrGold,10);
   y+=TITLE_H; DDivider("D0",y); y+=8;

   DLabel("K_STATUS", "Bot",        xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_NEXT",   "Next",       xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_SPREAD", "Spread",     xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_HOURS",  "Hours",      xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D1",y); y+=8;

   DLabel("K_LOT",    "Lot",        xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_TP",     "TP pts",     xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_SL",     "SL pts",     xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_MAXPOS", "MaxPos",     xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_CD",     "Cooldown",   xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D2",y); y+=8;

   DLabel("K_POS",    "Position",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_PNL",    "Float P&L",  xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_DAYPNL", "Day P&L",   xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D3",y); y+=8;

   DLabel("K_TOT",    "Trades",     xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_WIN",    "Wins",       xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_LOS",    "Losses",     xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_WR",     "Win Rate",   xK,y,CLR_KEY);
   ChartRedraw();
  }

void UpdateDashboard()
  {
   int xV=PANEL_X+155; int y=PANEL_Y+PAD+TITLE_H+8;

   // Bot status
   color stClr = g_botRunning ? CLR_GOOD : CLR_BAD;
   DLabel("V_STATUS", g_botRunning?"RUNNING":"STOPPED", xV,y,stClr); y+=ROW_H;

   // Next trade direction
   string nextTxt=g_lastWasBuy?"SELL ▼":"BUY ▲";
   color  nextClr=g_lastWasBuy?CLR_BAD:CLR_GOOD;
   DLabel("V_NEXT",nextTxt,xV,y,nextClr); y+=ROW_H;

   // Spread
   long sp=SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   color spC=(sp<=(long)g_maxSpread)?CLR_NEUTRAL:CLR_BAD;
   DLabel("V_SPREAD",IntegerToString((int)sp)+" / "+IntegerToString((int)g_maxSpread),xV,y,spC); y+=ROW_H;

   // Trading hours
   bool inHours=InTradingHours();
   DLabel("V_HOURS",inHours?"OPEN":"CLOSED",xV,y,inHours?CLR_GOOD:CLR_BAD); y+=ROW_H+8;

   // Settings
   DLabel("V_LOT",  DoubleToString(g_lot,2),         xV,y,CLR_HILITE); y+=ROW_H;
   DLabel("V_TP",   IntegerToString(g_tp)+" pts",     xV,y,CLR_HILITE); y+=ROW_H;
   DLabel("V_SL",   IntegerToString(g_sl)+" pts",     xV,y,CLR_HILITE); y+=ROW_H;
   DLabel("V_MAXPOS",IntegerToString(g_maxPositions), xV,y,CLR_HILITE); y+=ROW_H;
   int cdLeft=(int)MathMax(0,g_cooldownSecs-(int)(TimeCurrent()-g_lastEntryTime));
   DLabel("V_CD",   cdLeft>0?IntegerToString(cdLeft)+"s":"OK", xV,y,cdLeft>0?clrOrange:CLR_GOOD); y+=ROW_H+8;

   // Positions & PL
   int pos=CountPos();
   DLabel("V_POS",pos>0?(g_lastWasBuy?"LONG ▲":"SHORT ▼"):"NONE",
          xV,y,pos>0?(g_lastWasBuy?CLR_GOOD:CLR_BAD):CLR_NEUTRAL); y+=ROW_H;

   double pl=FloatPL();
   color plC=pl>0?CLR_GOOD:pl<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_PNL",(pl>=0?"+":"")+DoubleToString(pl,2),xV,y,plC); y+=ROW_H;

   color dayC=g_dayPL>0?CLR_GOOD:g_dayPL<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_DAYPNL",(g_dayPL>=0?"+":"")+DoubleToString(g_dayPL,2),xV,y,dayC); y+=ROW_H+8;

   // Stats
   DLabel("V_TOT",IntegerToString(g_totalTrades),xV,y,CLR_NEUTRAL); y+=ROW_H;
   DLabel("V_WIN",IntegerToString(g_wins),        xV,y,CLR_GOOD);   y+=ROW_H;
   DLabel("V_LOS",IntegerToString(g_losses),      xV,y,CLR_BAD);    y+=ROW_H;
   double wr=g_totalTrades>0?(double)g_wins/g_totalTrades*100.0:0.0;
   DLabel("V_WR",DoubleToString(wr,1)+"%",xV,y,wr>=50?CLR_GOOD:CLR_BAD);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);
   LoadSettings();
   CreateDashboard();
   EventSetTimer(10);
   Print("GoldRandom v11 ready | TP=",g_tp," SL=",g_sl," Lot=",g_lot);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ObjectsDeleteAll(0,DASH_PREFIX);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   UpdateDashboard();

   if(!g_botRunning) return;
   if(DayLimitHit())  { Print("GR: day limit hit"); return; }

   datetime barTime=iTime(_Symbol,InpTF,0);
   if(barTime==g_lastBar) return;
   g_lastBar=barTime;

   if(CountPos()>=g_maxPositions) { Print("GR: max positions reached"); return; }

   long sp=SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   if(sp>(long)g_maxSpread) { Print("GR: spread too high = ",sp); return; }

   if(!InTradingHours()) { Print("GR: outside trading hours"); return; }

   if(g_cooldownSecs>0 && (TimeCurrent()-g_lastEntryTime)<g_cooldownSecs)
     { Print("GR: cooldown active"); return; }

   Print("GR: opening trade, lastWasBuy=",g_lastWasBuy);
   if(g_lastWasBuy) OpenTrade(ORDER_TYPE_SELL);
   else             OpenTrade(ORDER_TYPE_BUY);
  }

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &req,
                        const MqlTradeResult  &res)
  {
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if(HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=(long)InpMagic) return;
   if(HistoryDealGetInteger(trans.deal,DEAL_ENTRY)!=DEAL_ENTRY_OUT) return;
   double profit=HistoryDealGetDouble(trans.deal,DEAL_PROFIT)
                +HistoryDealGetDouble(trans.deal,DEAL_SWAP)
                +HistoryDealGetDouble(trans.deal,DEAL_COMMISSION);
   g_totalPL+=profit;
   g_dayPL  +=profit;
   if(profit>=0) g_wins++; else g_losses++;
  }
//+------------------------------------------------------------------+
