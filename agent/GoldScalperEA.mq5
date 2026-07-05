//+------------------------------------------------------------------+
//|                                                GoldScalperEA.mq5 |
//|                                        GoldScalperX version 9.01 |
//|  Gold-specialized scalper — EMA9/21 + RSI7 + session filter      |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "9.01"
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
#define EA_NAME       "GoldScalperX"
#define EA_VERSION    "9.01"
#define DASH_PREFIX   "GSX_D_"
#define SETTINGS_FILE "GSX_Settings.json"

//--- panel layout
#define PANEL_X   10
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
         hEMA21 = INVALID_HANDLE, hATR = INVALID_HANDLE;
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
//| Read value from GSX_Settings.json in MT5 Common\Files            |
//+------------------------------------------------------------------+
double ReadJsonValue(const string key, const double fallback)
  {
   int fh = FileOpen(SETTINGS_FILE, FILE_READ|FILE_TXT|FILE_COMMON);
   if(fh == INVALID_HANDLE) return fallback;
   string content = "";
   while(!FileIsEnding(fh))
      content += FileReadString(fh);
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
      if(c=='-' || c=='.' || (c>='0' && c<='9')) { num += ShortToString(c); pos++; }
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
bool InTradingSession()
  {
   if(!UseSession) return true;
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   return (h >= 7 && h < 21);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_magic = MagicFromSymbol(_Symbol);
   trade.SetExpertMagicNumber(g_magic);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);

   hRSI   = iRSI(_Symbol, TF, 7,  PRICE_CLOSE);
   hEMA9  = iMA (_Symbol, TF, 9,  0, MODE_EMA, PRICE_CLOSE);
   hEMA21 = iMA (_Symbol, TF, 21, 0, MODE_EMA, PRICE_CLOSE);
   hATR   = iATR(_Symbol, TF, 7);

   if(hRSI==INVALID_HANDLE || hEMA9==INVALID_HANDLE ||
      hEMA21==INVALID_HANDLE || hATR==INVALID_HANDLE)
     { Print(EA_NAME,": indicator init failed"); return(INIT_FAILED); }

   LoadSettings();
   CreateDashboard();
   Print(EA_NAME," v",EA_VERSION," | Magic=",g_magic," | TF=",EnumToString(TF));
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
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
   for(int i = PositionsTotal()-1; i >= 0; i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==g_magic)
            cnt++;
   return cnt;
  }

//+------------------------------------------------------------------+
double MyFloatingPL()
  {
   double pl = 0.0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==g_magic)
            pl += posInfo.Profit() + posInfo.Swap();
   return pl;
  }

//+------------------------------------------------------------------+
bool StrongBullCandle(double o, double c, double h, double l)
  { double r=h-l; return r>1e-10 && (c-o)/r>=0.4; }

bool StrongBearCandle(double o, double c, double h, double l)
  { double r=h-l; return r>1e-10 && (o-c)/r>=0.4; }

//+------------------------------------------------------------------+
void OnTick()
  {
   LoadSettings();

   double rsi[],ema9[],ema21[],atr[],o[],h[],l[],c[];
   ArraySetAsSeries(rsi,true); ArraySetAsSeries(ema9,true);
   ArraySetAsSeries(ema21,true); ArraySetAsSeries(atr,true);
   ArraySetAsSeries(o,true); ArraySetAsSeries(h,true);
   ArraySetAsSeries(l,true); ArraySetAsSeries(c,true);

   if(CopyBuffer(hRSI,  0,0,3,rsi)  <3) return;
   if(CopyBuffer(hEMA9, 0,0,3,ema9) <3) return;
   if(CopyBuffer(hEMA21,0,0,3,ema21)<3) return;
   if(CopyBuffer(hATR,  0,0,2,atr)  <2) return;
   if(CopyOpen (_Symbol,TF,0,3,o)<3)    return;
   if(CopyHigh (_Symbol,TF,0,3,h)<3)    return;
   if(CopyLow  (_Symbol,TF,0,3,l)<3)    return;
   if(CopyClose(_Symbol,TF,0,3,c)<3)    return;

   double curRSI=rsi[0], curATR=atr[0];
   bool emaUp  = ema9[0]>ema21[0];
   bool emaDown= ema9[0]<ema21[0];
   bool crossUp= (ema9[1]<=ema21[1] && ema9[0]>ema21[0]);
   bool crossDn= (ema9[1]>=ema21[1] && ema9[0]<ema21[0]);
   bool bullBar= StrongBullCandle(o[1],c[1],h[1],l[1]);
   bool bearBar= StrongBearCandle(o[1],c[1],h[1],l[1]);

   ManagePositions(curRSI, crossUp, crossDn, curATR);

   int signal = 0;
   if((crossUp||emaUp)   && curRSI>=40.0 && curRSI<=78.0 && bullBar) signal= 1;
   else if((crossDn||emaDown) && curRSI>=22.0 && curRSI<=60.0 && bearBar) signal=-1;

   long spread    = SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   bool spreadOK  = (spread<=(long)g_maxSpread);
   bool cooldownOK= (TimeCurrent()-g_lastEntryTime>=g_cooldownSecs);
   bool slotsOK   = (CountMyPositions()<g_maxPositions);
   bool sessionOK = InTradingSession();
   bool allOK     = spreadOK && cooldownOK && slotsOK && sessionOK && curATR>0.0;

   if(signal!=0 && allOK)
     {
      if(signal==1) OpenTrade(ORDER_TYPE_BUY,  curATR);
      else          OpenTrade(ORDER_TYPE_SELL, curATR);
     }

   int cdLeft = (int)MathMax(0, g_cooldownSecs-(TimeCurrent()-g_lastEntryTime));
   bool blocked = !(spreadOK && slotsOK && sessionOK);

   UpdateDashboard(
      emaUp ? 1 : emaDown ? -1 : 0,
      curRSI, sessionOK, signal,
      blocked, cdLeft,
      CountMyPositions(), curATR, spread
   );
  }

//+------------------------------------------------------------------+
void OpenTrade(const ENUM_ORDER_TYPE type, const double atrVal)
  {
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double pt =SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   long sl0  =SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long frz  =SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double minD=MathMax((double)(sl0+frz+5),10.0)*pt;
   double slD =MathMax(atrVal*1.5,minD);
   double tpD =MathMax(atrVal*2.0,minD*1.5);
   double lot =NormalizeLot(g_lot);
   double sl,tp; bool ok;

   if(type==ORDER_TYPE_BUY)
     { sl=NormalizeDouble(ask-slD,digits); tp=NormalizeDouble(ask+tpD,digits);
       ok=trade.Buy(lot,_Symbol,ask,sl,tp,EA_NAME); }
   else
     { sl=NormalizeDouble(bid+slD,digits); tp=NormalizeDouble(bid-tpD,digits);
       ok=trade.Sell(lot,_Symbol,bid,sl,tp,EA_NAME); }

   if(ok) { g_lastEntryTime=TimeCurrent(); g_totalTrades++;
             Print(EA_NAME,": ",EnumToString(type)," lot=",lot," sl=",sl," tp=",tp); }
   else   Print(EA_NAME,": FAIL ",trade.ResultRetcode()," ",trade.ResultComment());
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
void ManagePositions(double curRSI,bool crossUp,bool crossDn,double atrVal)
  {
   double pt=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   long sl0=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double minD=MathMax((double)(sl0+5),10.0)*pt;
   double trail=MathMax(atrVal*1.0,minD);

   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol||posInfo.Magic()!=g_magic) continue;
      ulong  tk=posInfo.Ticket();
      double op=posInfo.PriceOpen(), cp=posInfo.PriceCurrent();
      double sl=posInfo.StopLoss(),  tp=posInfo.TakeProfit();

      if(posInfo.PositionType()==POSITION_TYPE_BUY)
        {
         double gain=cp-op;
         if(curRSI>78.0||crossDn||(atrVal>0&&gain>=atrVal*2.0))
           {trade.PositionClose(tk);continue;}
         if(atrVal>0&&gain>trail)
           { double nsl=NormalizeDouble(cp-trail,digits);
             if(nsl>sl+pt&&cp-nsl>=minD) trade.PositionModify(tk,nsl,tp); }
        }
      else
        {
         double gain=op-cp;
         if(curRSI<22.0||crossUp||(atrVal>0&&gain>=atrVal*2.0))
           {trade.PositionClose(tk);continue;}
         if(atrVal>0&&gain>trail)
           { double nsl=NormalizeDouble(cp+trail,digits);
             if((sl==0.0||nsl<sl-pt)&&nsl-cp>=minD) trade.PositionModify(tk,nsl,tp); }
        }
     }
  }

//+------------------------------------------------------------------+
//| Dashboard helpers                                                |
//+------------------------------------------------------------------+
void DLabel(const string id, const string txt, const int x, const int y,
            const color clr, const int fs=9)
  {
   string nm=DASH_PREFIX+id;
   if(ObjectFind(0,nm)<0)
     {
      ObjectCreate(0,nm,OBJ_LABEL,0,0,0);
      ObjectSetInteger(0,nm,OBJPROP_CORNER,    CORNER_LEFT_UPPER);
      ObjectSetInteger(0,nm,OBJPROP_BACK,      false);
      ObjectSetInteger(0,nm,OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0,nm,OBJPROP_HIDDEN,    true);
      ObjectSetInteger(0,nm,OBJPROP_ZORDER,    1);
      ObjectSetString (0,nm,OBJPROP_FONT,      "Consolas");
     }
   ObjectSetInteger(0,nm,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,nm,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,nm,OBJPROP_COLOR,clr);
   ObjectSetInteger(0,nm,OBJPROP_FONTSIZE,fs);
   ObjectSetString (0,nm,OBJPROP_TEXT,txt);
  }

void DDivider(const string id, const int y)
  {
   string nm=DASH_PREFIX+id;
   if(ObjectFind(0,nm)<0)
     {
      ObjectCreate(0,nm,OBJ_RECTANGLE_LABEL,0,0,0);
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
      ObjectSetInteger(0,nm,OBJPROP_ZORDER,     1);
     }
   ObjectSetInteger(0,nm,OBJPROP_YDISTANCE,y);
  }

//+------------------------------------------------------------------+
void CreateDashboard()
  {
   // calc panel height: title + 4 dividers + 11 data rows + padding
   int panelH = PAD + TITLE_H + 4*8 + 11*ROW_H + PAD;

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
   ObjectSetInteger(0,bg,OBJPROP_COLOR,      CLR_BORDER);
   ObjectSetInteger(0,bg,OBJPROP_WIDTH,      1);
   ObjectSetInteger(0,bg,OBJPROP_BACK,       false);
   ObjectSetInteger(0,bg,OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0,bg,OBJPROP_HIDDEN,     true);
   ObjectSetInteger(0,bg,OBJPROP_ZORDER,     0);

   int xK=PANEL_X+PAD, xV=PANEL_X+140;
   int y=PANEL_Y+PAD;

   // title
   DLabel("TITLE", EA_NAME+" v"+EA_VERSION+"  "+_Symbol, xK, y, clrGold, 10);
   y+=TITLE_H; DDivider("D0",y); y+=8;

   // group 1: market info
   DLabel("K_MAGIC","Magic",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_TREND","Trend",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_RSI",  "RSI(7)",  xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D1",y); y+=8;

   // group 2: session & signal
   DLabel("K_SESS", "Session", xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_SIG",  "Signal",  xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_ENTRY","Entry",   xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D2",y); y+=8;

   // group 3: account
   DLabel("K_POS",   "Positions",xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_PNL",   "Float P&L",xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_TRADES","Trades",   xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D3",y); y+=8;

   // group 4: market data
   DLabel("K_SPREAD","Spread",xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_ATR",   "ATR",   xK,y,CLR_KEY);

   ChartRedraw();
  }

//+------------------------------------------------------------------+
void UpdateDashboard(const int trend, const double rsi,
                     const bool sessionOK, const int signal,
                     const bool blocked, const int cdSec,
                     const int posCount, const double atrVal,
                     const long spreadPts)
  {
   int xV=PANEL_X+140;
   int y=PANEL_Y+PAD+TITLE_H+8;

   // magic
   DLabel("V_MAGIC",(string)g_magic, xV,y,CLR_HILITE); y+=ROW_H;

   // trend
   string tTxt=trend>0?"UP":trend<0?"DOWN":"FLAT";
   color  tClr=trend>0?CLR_GOOD:trend<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_TREND",tTxt,xV,y,tClr); y+=ROW_H;

   // rsi
   color rClr=rsi>=70?CLR_BAD:rsi<=30?CLR_GOOD:CLR_NEUTRAL;
   DLabel("V_RSI",DoubleToString(rsi,1),xV,y,rClr); y+=ROW_H+8;

   // session
   DLabel("V_SESS",sessionOK?"ACTIVE":"CLOSED",xV,y,sessionOK?CLR_GOOD:CLR_BAD); y+=ROW_H;

   // signal
   string sTxt=signal>0?"BUY":signal<0?"SELL":"NONE";
   color  sClr=signal>0?CLR_GOOD:signal<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_SIG",sTxt,xV,y,sClr); y+=ROW_H;

   // entry
   string eTxt; color eClr;
   if(blocked)   {eTxt="BLOCKED";            eClr=CLR_BAD;}
   else if(cdSec>0){eTxt="CD "+string(cdSec)+"s"; eClr=clrOrange;}
   else          {eTxt="READY";              eClr=CLR_GOOD;}
   DLabel("V_ENTRY",eTxt,xV,y,eClr); y+=ROW_H+8;

   // positions
   color pClr=posCount>=g_maxPositions?CLR_BAD:CLR_HILITE;
   DLabel("V_POS",string(posCount)+" / "+string(g_maxPositions),xV,y,pClr); y+=ROW_H;

   // p&l
   double pl=MyFloatingPL();
   color  plClr=pl>0?CLR_GOOD:pl<0?CLR_BAD:CLR_NEUTRAL;
   string plTxt=(pl>=0?"+":"")+DoubleToString(pl,2);
   DLabel("V_PNL",plTxt,xV,y,plClr); y+=ROW_H;

   // trades
   DLabel("V_TRADES",string(g_totalTrades),xV,y,CLR_NEUTRAL); y+=ROW_H+8;

   // spread
   color spClr=spreadPts>50?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_SPREAD",string(spreadPts)+" pts",xV,y,spClr); y+=ROW_H;

   // atr
   DLabel("V_ATR",DoubleToString(atrVal,_Digits),xV,y,CLR_HILITE);

   ChartRedraw();
  }
//+------------------------------------------------------------------+
