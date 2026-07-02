//+------------------------------------------------------------------+
//|                                        GoldScalperX_v6.mq5       |
//|            Fast Multi-Symbol Scalping EA - Aggressive Mode        |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "6.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

input double          LotSize       = 0.01;
input int             MaxSpread     = 500;
input int             RSI_Period    = 7;
input int             EMA_Fast      = 8;
input int             EMA_Slow      = 21;
input int             ATR_Period    = 14;
input double          ATR_SL_Mult   = 1.5;
input double          ATR_TP_Mult   = 2.5;
input bool            UseTrailing   = true;
input double          TrailATR_Mult = 1.0;
input int             MaxPositions  = 3;
input int             CooldownSecs  = 15;
input ENUM_TIMEFRAMES TF            = PERIOD_M5;

#define BOT_NAME    "GoldScalperX"
#define DASH_PREFIX "GSX_D_"
#define GV_PREFIX   "GSX_"

int      g_magic = 0;
CTrade        trade;
CPositionInfo posInfo;

int hRSI=INVALID_HANDLE, hEMAFast=INVALID_HANDLE;
int hEMASlow=INVALID_HANDLE, hATR=INVALID_HANDLE;

double g_rsi=50, g_emaFast=0, g_emaSlow=0, g_atr=0;
double g_LotSize=0.01, g_slMult=1.5, g_tpMult=2.5, g_trailMult=1.0;
int    g_MaxSpread=500, g_MaxPos=3, g_cooldown=15;

string   g_lastSignal="NONE";
datetime g_lastSignalTime=0, g_lastTradeTime=0;
int      g_totalTrades=0;
bool     g_running=false;

//+------------------------------------------------------------------+
int MagicFromSymbol(string sym)
  {
   int h=100000;
   for(int i=0;i<StringLen(sym);i++) h=h*31+(int)StringGetCharacter(sym,i);
   return MathAbs(h)%900000+100000;
  }

double GV(string key,double fb)
  { return GlobalVariableCheck(GV_PREFIX+key)?GlobalVariableGet(GV_PREFIX+key):fb; }

void LoadSettings()
  {
   g_LotSize   = GV("LotSize",      LotSize);
   g_MaxSpread = (int)GV("MaxSpread",    MaxSpread);
   g_MaxPos    = (int)GV("MaxPositions", MaxPositions);
   g_slMult    = GV("ATR_SL_Mult",  ATR_SL_Mult);
   g_tpMult    = GV("ATR_TP_Mult",  ATR_TP_Mult);
   g_trailMult = GV("TrailATR_Mult",TrailATR_Mult);
   g_cooldown  = (int)GV("CooldownSecs",CooldownSecs);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_magic=MagicFromSymbol(_Symbol);
   trade.SetExpertMagicNumber(g_magic);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);

   hRSI     = iRSI(_Symbol,TF,RSI_Period,PRICE_CLOSE);
   hEMAFast = iMA(_Symbol,TF,EMA_Fast,0,MODE_EMA,PRICE_CLOSE);
   hEMASlow = iMA(_Symbol,TF,EMA_Slow,0,MODE_EMA,PRICE_CLOSE);
   hATR     = iATR(_Symbol,TF,ATR_Period);

   if(hRSI==INVALID_HANDLE||hEMAFast==INVALID_HANDLE||
      hEMASlow==INVALID_HANDLE||hATR==INVALID_HANDLE)
     { Print(BOT_NAME,"[",_Symbol,"]: FAILED handles"); return(INIT_FAILED); }

   LoadSettings();
   g_running=true;
   CreateDashboard();
   Print(BOT_NAME,"[",_Symbol,"]: INIT v6 | Magic=",g_magic,
         " TF=",EnumToString(TF)," SLx",ATR_SL_Mult," TPx",ATR_TP_Mult);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   g_running=false;
   IndicatorRelease(hRSI); IndicatorRelease(hEMAFast);
   IndicatorRelease(hEMASlow); IndicatorRelease(hATR);
   ObjectsDeleteAll(0,DASH_PREFIX);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   if(!UpdateIndicators()) return;
   LoadSettings();
   if(UseTrailing) ManageTrailing();

   long spread=SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   if(spread > g_MaxSpread) { UpdateDashboard(); return; }
   if(TimeCurrent()-g_lastTradeTime < g_cooldown) { UpdateDashboard(); return; }
   if(OpenPositionsCount() >= g_MaxPos) { UpdateDashboard(); return; }

   bool trendUp   = g_emaFast > g_emaSlow;
   bool trendDown = g_emaFast < g_emaSlow;

   bool buySignal  = trendUp   && g_rsi > 40.0 && g_rsi < 70.0;
   bool sellSignal = trendDown && g_rsi > 30.0 && g_rsi < 60.0;

   bool hasBuy=false, hasSell=false;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(posInfo.SelectByIndex(i)&&posInfo.Symbol()==_Symbol&&posInfo.Magic()==g_magic)
        {
         if(posInfo.PositionType()==POSITION_TYPE_BUY)  hasBuy=true;
         if(posInfo.PositionType()==POSITION_TYPE_SELL) hasSell=true;
        }
     }

   if(buySignal && !hasBuy)
     {
      if(hasSell) CloseAllPositions(POSITION_TYPE_SELL);
      OpenPosition(ORDER_TYPE_BUY);
     }
   else if(sellSignal && !hasSell)
     {
      if(hasBuy) CloseAllPositions(POSITION_TYPE_BUY);
      OpenPosition(ORDER_TYPE_SELL);
     }

   UpdateDashboard();
  }

//+------------------------------------------------------------------+
bool UpdateIndicators()
  {
   double r[1],f[1],s[1],a[1];
   if(CopyBuffer(hRSI,    0,0,1,r)<1) return false;
   if(CopyBuffer(hEMAFast,0,0,1,f)<1) return false;
   if(CopyBuffer(hEMASlow,0,0,1,s)<1) return false;
   if(CopyBuffer(hATR,    0,1,1,a)<1) return false;
   g_rsi=r[0]; g_emaFast=f[0]; g_emaSlow=s[0]; g_atr=a[0];
   return true;
  }

//+------------------------------------------------------------------+
void OpenPosition(ENUM_ORDER_TYPE type)
  {
   if(g_atr <= 0) return;
   double point   = SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   long   stopLvl = SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = (stopLvl+5)*point;
   double slDist  = MathMax(g_atr*g_slMult, minDist);
   double tpDist  = MathMax(g_atr*g_tpMult, minDist);

   double price,sl,tp;
   if(type==ORDER_TYPE_BUY)
     {
      price = SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      sl    = NormalizeDouble(price-slDist,_Digits);
      tp    = NormalizeDouble(price+tpDist,_Digits);
      if(trade.Buy(g_LotSize,_Symbol,price,sl,tp,BOT_NAME))
        {
         g_totalTrades++; g_lastSignal="BUY";
         g_lastSignalTime=TimeCurrent(); g_lastTradeTime=TimeCurrent();
         Print(BOT_NAME,"[",_Symbol,"]: BUY @",DoubleToString(price,_Digits),
               " SL=",DoubleToString(sl,_Digits)," TP=",DoubleToString(tp,_Digits));
        }
      else
         Print(BOT_NAME,"[",_Symbol,"]: BUY FAILED | ",trade.ResultRetcode(),
               " ",trade.ResultRetcodeDescription());
     }
   else
     {
      price = SymbolInfoDouble(_Symbol,SYMBOL_BID);
      sl    = NormalizeDouble(price+slDist,_Digits);
      tp    = NormalizeDouble(price-tpDist,_Digits);
      if(trade.Sell(g_LotSize,_Symbol,price,sl,tp,BOT_NAME))
        {
         g_totalTrades++; g_lastSignal="SELL";
         g_lastSignalTime=TimeCurrent(); g_lastTradeTime=TimeCurrent();
         Print(BOT_NAME,"[",_Symbol,"]: SELL @",DoubleToString(price,_Digits),
               " SL=",DoubleToString(sl,_Digits)," TP=",DoubleToString(tp,_Digits));
        }
      else
         Print(BOT_NAME,"[",_Symbol,"]: SELL FAILED | ",trade.ResultRetcode(),
               " ",trade.ResultRetcodeDescription());
     }
  }

//+------------------------------------------------------------------+
void ManageTrailing()
  {
   if(g_atr <= 0) return;
   double point   = SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   long   stopLvl = SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = (stopLvl+5)*point;
   double trail   = MathMax(g_atr*g_trailMult, minDist);

   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol || posInfo.Magic()!=g_magic) continue;
      ulong  ticket = posInfo.Ticket();
      double curSL  = posInfo.StopLoss();
      if(posInfo.PositionType()==POSITION_TYPE_BUY)
        {
         double bid   = SymbolInfoDouble(_Symbol,SYMBOL_BID);
         double newSL = NormalizeDouble(bid-trail,_Digits);
         if(newSL > curSL+point)
            trade.PositionModify(ticket,newSL,posInfo.TakeProfit());
        }
      else
        {
         double ask   = SymbolInfoDouble(_Symbol,SYMBOL_ASK);
         double newSL = NormalizeDouble(ask+trail,_Digits);
         if(curSL==0 || newSL < curSL-point)
            trade.PositionModify(ticket,newSL,posInfo.TakeProfit());
        }
     }
  }

//+------------------------------------------------------------------+
void CloseAllPositions(ENUM_POSITION_TYPE type)
  {
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(posInfo.SelectByIndex(i) && posInfo.Symbol()==_Symbol &&
         posInfo.Magic()==g_magic  && posInfo.PositionType()==type)
        {
         ulong t=posInfo.Ticket(); double p=posInfo.Profit();
         if(trade.PositionClose(t))
            Print(BOT_NAME,"[",_Symbol,"]: CLOSED #",t," P=",DoubleToString(p,2),"$");
        }
     }
  }

int OpenPositionsCount()
  {
   int c=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i)&&posInfo.Symbol()==_Symbol&&posInfo.Magic()==g_magic) c++;
   return c;
  }

double FloatingProfit()
  {
   double p=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i)&&posInfo.Symbol()==_Symbol&&posInfo.Magic()==g_magic)
         p+=posInfo.Profit()+posInfo.Swap();
   return p;
  }

//+------------------------------------------------------------------+
void CreatePanel(string name,int x,int y,int w,int h)
  {
   ObjectCreate(0,name,OBJ_RECTANGLE_LABEL,0,0,0);
   ObjectSetInteger(0,name,OBJPROP_CORNER,    CORNER_LEFT_UPPER);
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0,name,OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0,name,OBJPROP_XSIZE,     w);
   ObjectSetInteger(0,name,OBJPROP_YSIZE,     h);
   ObjectSetInteger(0,name,OBJPROP_BGCOLOR,   C'15,15,25');
   ObjectSetInteger(0,name,OBJPROP_BORDER_COLOR,clrDimGray);
   ObjectSetInteger(0,name,OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0,name,OBJPROP_BACK,      false);
   ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
   ObjectSetInteger(0,name,OBJPROP_HIDDEN,    true);
  }

void CreateLbl(string name,int x,int y)
  {
   ObjectCreate(0,name,OBJ_LABEL,0,0,0);
   ObjectSetInteger(0,name,OBJPROP_CORNER,    CORNER_LEFT_UPPER);
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0,name,OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0,name,OBJPROP_FONTSIZE,  9);
   ObjectSetString(0,name,OBJPROP_FONT,       "Consolas");
   ObjectSetInteger(0,name,OBJPROP_COLOR,     clrWhite);
   ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
   ObjectSetInteger(0,name,OBJPROP_HIDDEN,    true);
  }

void SetLbl(int idx,string text,color clr)
  {
   string name=DASH_PREFIX+"L"+IntegerToString(idx);
   ObjectSetString(0,name,OBJPROP_TEXT,text);
   ObjectSetInteger(0,name,OBJPROP_COLOR,clr);
  }

void CreateDashboard()
  {
   CreatePanel(DASH_PREFIX+"BG",10,20,290,260);
   for(int i=0;i<13;i++) CreateLbl(DASH_PREFIX+"L"+IntegerToString(i),18,30+i*19);
   UpdateDashboard();
  }

void UpdateDashboard()
  {
   long   spread  = SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   double profit  = FloatingProfit();
   int    openCnt = OpenPositionsCount();
   bool   usingGV = GlobalVariableCheck(GV_PREFIX+"LotSize");

   string trend; color trendClr;
   if(g_emaFast>g_emaSlow)      { trend="UP  "; trendClr=clrLime; }
   else if(g_emaFast<g_emaSlow) { trend="DOWN"; trendClr=clrRed;  }
   else                         { trend="FLAT"; trendClr=clrWhite; }

   color profClr = profit>0?clrLime:profit<0?clrRed:clrWhite;
   color sprdClr = spread>g_MaxSpread?clrRed:clrLime;
   color rsiClr  = (g_rsi>70||g_rsi<30)?clrOrange:clrDeepSkyBlue;

   long coolLeft = (long)g_cooldown-(long)(TimeCurrent()-g_lastTradeTime);
   string readyStr = coolLeft>0?("Wait "+IntegerToString((int)coolLeft)+"s"):"READY";
   color  readyClr = coolLeft>0?clrOrange:clrLime;

   SetLbl(0,  "GoldScalperX v6  ["+_Symbol+"]",              clrGold);
   SetLbl(1,  "TF:"+EnumToString(TF)+"  Magic:"+IntegerToString(g_magic), clrSilver);
   SetLbl(2,  "-------------------------",                    clrDimGray);
   SetLbl(3,  "Trend:"+trend+"  RSI:"+DoubleToString(g_rsi,1), trendClr);
   SetLbl(4,  "ATR  :"+DoubleToString(g_atr,_Digits),        rsiClr);
   SetLbl(5,  "Sprd :"+IntegerToString((int)spread),          sprdClr);
   SetLbl(6,  "-------------------------",                    clrDimGray);
   SetLbl(7,  "Signal:"+g_lastSignal,                         g_lastSignal=="BUY"?clrLime:g_lastSignal=="SELL"?clrRed:clrWhite);
   SetLbl(8,  "Entry :"+readyStr,                             readyClr);
   SetLbl(9,  "Cfg   :"+(usingGV?"Dashboard":"Local"),        usingGV?clrLime:clrYellow);
   SetLbl(10, "-------------------------",                    clrDimGray);
   SetLbl(11, "Open:"+IntegerToString(openCnt)+"/"+IntegerToString(g_MaxPos)
              +"  P/L:"+DoubleToString(profit,2)+"$",         profClr);
   SetLbl(12, "Trades:"+IntegerToString(g_totalTrades)
              +"  Lot:"+DoubleToString(g_LotSize,2),          clrWhite);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
