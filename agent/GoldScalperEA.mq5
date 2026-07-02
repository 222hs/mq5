//+------------------------------------------------------------------+
//|                                               GoldScalperEA.mq5  |
//|                     RSI + Stochastic Scalper for XAUUSD (M1/M5)  |
//+------------------------------------------------------------------+
#property copyright "GoldScalperEA"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- Inputs
input double LotSize        = 0.01;    // Lot Size
input int    TakeProfit     = 25;      // Take Profit (pips)
input int    StopLoss       = 35;      // Stop Loss (pips)
input int    RSI_Period     = 7;       // RSI Period
input int    MaxSpread      = 500;     // Max Spread (points)
input int    Stoch_K        = 5;       // Stochastic %K
input int    Stoch_D        = 3;       // Stochastic %D
input int    Stoch_Slowing  = 3;       // Stochastic Slowing
input double RSI_BuyLevel   = 45.0;    // RSI Buy below
input double RSI_SellLevel  = 55.0;    // RSI Sell above
input int    MaxPositions   = 1;       // Max simultaneous positions
input long   MagicNumber    = 888888;  // Magic Number

//--- Globals
CTrade        trade;
CPositionInfo posInfo;
int    rsiHandle    = INVALID_HANDLE;
int    stochHandle  = INVALID_HANDLE;
string lastSignal   = "None";
datetime lastBarTime = 0;
double pipFactor;

//+------------------------------------------------------------------+
int OnInit()
  {
   rsiHandle   = iRSI(_Symbol,_Period,RSI_Period,PRICE_CLOSE);
   stochHandle = iStochastic(_Symbol,_Period,Stoch_K,Stoch_D,Stoch_Slowing,MODE_SMA,STO_LOWHIGH);

   if(rsiHandle==INVALID_HANDLE || stochHandle==INVALID_HANDLE)
     {
      Print("Failed to create indicator handles");
      return(INIT_FAILED);
     }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);

   pipFactor = (_Digits==3 || _Digits==2) ? 10.0 : 1.0;

   CreateDashboard();
   Print("GoldScalperEA started. Magic=",MagicNumber," TF=",EnumToString(_Period));
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   if(rsiHandle!=INVALID_HANDLE)   IndicatorRelease(rsiHandle);
   if(stochHandle!=INVALID_HANDLE) IndicatorRelease(stochHandle);
   ObjectsDeleteAll(0,"GSEA_");
   Comment("");
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   double rsi[2], stK[3], stD[3];
   if(CopyBuffer(rsiHandle,0,0,2,rsi)<2)              { UpdateDashboard(0,0,0); return; }
   if(CopyBuffer(stochHandle,MAIN_LINE,0,3,stK)<3)    { UpdateDashboard(rsi[1],0,0); return; }
   if(CopyBuffer(stochHandle,SIGNAL_LINE,0,3,stD)<3)  { UpdateDashboard(rsi[1],0,0); return; }

   double rsiCur = rsi[1];
   double kCur = stK[2], dCur = stD[2];
   double kPrev = stK[1], dPrev = stD[1];

   UpdateDashboard(rsiCur,kCur,dCur);

   datetime barTime = iTime(_Symbol,_Period,0);
   if(barTime==lastBarTime) return;

   long spread = SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   if(spread>MaxSpread) return;

   if(CountPositions()>=MaxPositions) return;

   bool crossUp   = (kPrev<=dPrev && kCur>dCur);
   bool crossDown = (kPrev>=dPrev && kCur<dCur);

   double ask = SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double tpDist = TakeProfit*pipFactor*_Point;
   double slDist = StopLoss*pipFactor*_Point;

   if(rsiCur<RSI_BuyLevel)
     {
      lastBarTime=barTime;
      lastSignal = "BUY @ "+TimeToString(TimeCurrent(),TIME_MINUTES);
      PrintFormat("SIGNAL BUY | RSI=%.2f K=%.2f D=%.2f Spread=%d",rsiCur,kCur,dCur,(int)spread);
      double sl = NormalizeDouble(ask-slDist,_Digits);
      double tp = NormalizeDouble(ask+tpDist,_Digits);
      if(trade.Buy(LotSize,_Symbol,ask,sl,tp,"GSEA Buy"))
         PrintFormat("BUY OPENED | Ticket=%I64u Price=%.2f SL=%.2f TP=%.2f",trade.ResultOrder(),ask,sl,tp);
      else
         PrintFormat("BUY FAILED | Error=%d %s",trade.ResultRetcode(),trade.ResultRetcodeDescription());
     }
   else if(rsiCur>RSI_SellLevel)
     {
      lastBarTime=barTime;
      lastSignal = "SELL @ "+TimeToString(TimeCurrent(),TIME_MINUTES);
      PrintFormat("SIGNAL SELL | RSI=%.2f K=%.2f D=%.2f Spread=%d",rsiCur,kCur,dCur,(int)spread);
      double sl = NormalizeDouble(bid+slDist,_Digits);
      double tp = NormalizeDouble(bid-tpDist,_Digits);
      if(trade.Sell(LotSize,_Symbol,bid,sl,tp,"GSEA Sell"))
         PrintFormat("SELL OPENED | Ticket=%I64u Price=%.2f SL=%.2f TP=%.2f",trade.ResultOrder(),bid,sl,tp);
      else
         PrintFormat("SELL FAILED | Error=%d %s",trade.ResultRetcode(),trade.ResultRetcodeDescription());
     }
  }

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if(HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=MagicNumber) return;
   if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal,DEAL_ENTRY)==DEAL_ENTRY_OUT)
     {
      double profit = HistoryDealGetDouble(trans.deal,DEAL_PROFIT);
      ENUM_DEAL_REASON reason = (ENUM_DEAL_REASON)HistoryDealGetInteger(trans.deal,DEAL_REASON);
      PrintFormat("POSITION CLOSED | Deal=%I64u Profit=%.2f Reason=%s",
                  trans.deal, profit,
                  reason==DEAL_REASON_TP ? "TakeProfit" :
                  reason==DEAL_REASON_SL ? "StopLoss" : "Other");
     }
  }

//+------------------------------------------------------------------+
int CountPositions()
  {
   int count=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i) && posInfo.Magic()==MagicNumber && posInfo.Symbol()==_Symbol)
         count++;
   return count;
  }

//+------------------------------------------------------------------+
double CurrentProfit()
  {
   double p=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i) && posInfo.Magic()==MagicNumber && posInfo.Symbol()==_Symbol)
         p += posInfo.Profit()+posInfo.Swap();
   return p;
  }

//+------------------------------------------------------------------+
void CreateLabel(string name,int x,int y,string text,color clr,int size=10)
  {
   string obj="GSEA_"+name;
   if(ObjectFind(0,obj)<0)
     {
      ObjectCreate(0,obj,OBJ_LABEL,0,0,0);
      ObjectSetInteger(0,obj,OBJPROP_CORNER,CORNER_LEFT_UPPER);
      ObjectSetInteger(0,obj,OBJPROP_XDISTANCE,x);
      ObjectSetInteger(0,obj,OBJPROP_YDISTANCE,y);
      ObjectSetInteger(0,obj,OBJPROP_FONTSIZE,size);
      ObjectSetString(0,obj,OBJPROP_FONT,"Consolas");
      ObjectSetInteger(0,obj,OBJPROP_SELECTABLE,false);
     }
   ObjectSetString(0,obj,OBJPROP_TEXT,text);
   ObjectSetInteger(0,obj,OBJPROP_COLOR,clr);
  }

//+------------------------------------------------------------------+
void CreateDashboard()
  {
   string bg="GSEA_BG";
   if(ObjectFind(0,bg)<0)
     {
      ObjectCreate(0,bg,OBJ_RECTANGLE_LABEL,0,0,0);
      ObjectSetInteger(0,bg,OBJPROP_CORNER,CORNER_LEFT_UPPER);
      ObjectSetInteger(0,bg,OBJPROP_XDISTANCE,10);
      ObjectSetInteger(0,bg,OBJPROP_YDISTANCE,20);
      ObjectSetInteger(0,bg,OBJPROP_XSIZE,260);
      ObjectSetInteger(0,bg,OBJPROP_YSIZE,150);
      ObjectSetInteger(0,bg,OBJPROP_BGCOLOR,C'20,20,30');
      ObjectSetInteger(0,bg,OBJPROP_BORDER_TYPE,BORDER_FLAT);
      ObjectSetInteger(0,bg,OBJPROP_COLOR,clrGoldenrod);
      ObjectSetInteger(0,bg,OBJPROP_BACK,false);
      ObjectSetInteger(0,bg,OBJPROP_SELECTABLE,false);
     }
   CreateLabel("Title",20,26,"GOLD SCALPER EA",clrGold,11);
   UpdateDashboard(0,0,0);
  }

//+------------------------------------------------------------------+
void UpdateDashboard(double rsiVal,double kVal,double dVal)
  {
   bool tradingOK = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) &&
                    (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
   long spread = SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   double profit = CurrentProfit();

   CreateLabel("Status",20,46,"Status : "+(tradingOK?"RUNNING":"STOPPED"),
               tradingOK?clrLime:clrRed);
   CreateLabel("RSI",   20,66,StringFormat("RSI(%d) : %.2f",RSI_Period,rsiVal),
               rsiVal<RSI_BuyLevel?clrLime:(rsiVal>RSI_SellLevel?clrRed:clrWhite));
   CreateLabel("Stoch", 20,86,StringFormat("Stoch  : K=%.1f D=%.1f",kVal,dVal),clrWhite);
   CreateLabel("Pos",   20,106,"Trades : "+(string)CountPositions(),clrWhite);
   CreateLabel("PL",    20,126,StringFormat("P/L    : %.2f %s",profit,AccountInfoString(ACCOUNT_CURRENCY)),
               profit>=0?clrLime:clrRed);
   CreateLabel("Sig",   20,146,"Signal : "+lastSignal+"  Spr:"+(string)spread,clrSilver);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
